// Pruebas de la F8 del módulo de Puntos QR (ubicación y mapa operativo) contra
// la base REAL, dentro de una transacción que se revierte al final.
//
// Qué comprueba:
//   1. que el archivo de migración corra COMPLETO dos veces seguidas en la
//      misma transacción (idempotencia de verdad);
//   2. la estructura: las cinco tablas, el alcance de §2.4 (grupo_id NOT NULL,
//      sede_id nullable en la ubicación), la RLS activa, los índices que la
//      fase promete (incluido el BRIN de la purga) y el realtime;
//   3. R1, el requisito no negociable: fuera de turno la ubicación se RECHAZA
//      y no deja rastro parcial; con el contrato sin seguimiento en vivo,
//      también; sin consentimiento, también; y el rechazo queda auditado;
//   4. R2: `antiguedad_seg` la calcula el servidor, viaja con `fuente`, y una
//      posición pasada la frescura del contrato sale con `en_vivo = false`;
//      una posición de 40 minutos no se puede presentar como actual;
//   5. el freno de volumen: intervalo mínimo, fuera de orden y tope por turno;
//   6. que al cerrar el turno la persona desaparece del mapa en vivo y su
//      rastro sigue en el historial;
//   7. el replay: diezmado en SQL, con el primero y el último siempre;
//   8. `ronda_proxima_parada()`, que es el gancho de F10;
//   9. la purga por retención y el cierre automático de turnos vencidos;
//  10. el alcance por contrato de la RLS: un usuario de un contrato NO lee la
//      ubicación de las personas de otro, y nadie la lee si el contrato no
//      permite el seguimiento.
//
// NO aplica nada: todo va dentro de BEGIN … ROLLBACK, y los datos de prueba se
// crean dentro de la transacción (ninguna persona ni sede real).
//
// Uso (desde la raíz del worktree):
//   node --use-system-ca scripts/probar-puntos-qr-f8.mjs
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

const mig = (f) => readFileSync(join(raiz, 'supabase', 'migrations', f), 'utf8')
const SQL_F8 = mig('20261028000800_puntos_qr_f8_ubicacion_mapa.sql')
// El arreglo del flag va DESPUÉS de 800 a propósito: 800 vuelve a crear las
// funciones del replay en su forma vieja (con el hueco), así que si se aplicara
// al revés el arreglo quedaría deshecho dentro de la transacción de prueba.
const SQL_F8_FLAG = mig('20261028000811_puntos_qr_f8_recorrido_respeta_contrato.sql')
// Y la ventana hacia atrás va después del arreglo del flag, por lo mismo: vuelve
// a crear las dos funciones del replay, así que aplicarla antes dejaría el
// arreglo del flag encima sin la ventana.
const SQL_F8_VENTANA = mig('20261028000813_puntos_qr_f8_ventana_recorrido.sql')

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
// Volver al dueño es RESET ROLE **y** olvidar el JWT: `set_config(..., true)`
// dura toda la transacción, así que sin esto `auth.uid()` sigue devolviendo al
// último usuario y las funciones siguen pidiéndole sus permisos.
const comoDueno = async () => {
  await c.query('RESET ROLE')
  await c.query(`SELECT set_config('request.jwt.claims', '', true)`)
}
let sp = 0
const enSavepoint = async (fn) => {
  const n = `p${++sp}`
  await c.query(`SAVEPOINT ${n}`)
  try { const r = await fn(); await c.query(`RELEASE SAVEPOINT ${n}`); return { ok: true, r } }
  catch (e) { await c.query(`ROLLBACK TO SAVEPOINT ${n}`); return { ok: false, error: e.message } }
}
const una = async (sql, params = []) => (await c.query(sql, params)).rows[0]
const todas = async (sql, params = []) => (await c.query(sql, params)).rows

await c.query('BEGIN')
try {
  // ── 1. Idempotencia ───────────────────────────────────────────────────────
  console.log('\n1) Idempotencia (el archivo completo, dos veces en la misma transacción)')
  await c.query(SQL_F8)
  check('primera pasada', true)
  await c.query(SQL_F8)
  check('segunda pasada sin error', true)
  await c.query(SQL_F8_FLAG)
  check('el arreglo del flag se aplica sobre la fase ya aplicada', true)
  await c.query(SQL_F8_FLAG)
  check('y también dos veces seguidas', true)
  await c.query(SQL_F8_VENTANA)
  check('la ventana hacia atrás se aplica encima', true)
  await c.query(SQL_F8_VENTANA)
  check('y también dos veces seguidas', true)

  // ── 2. Estructura ─────────────────────────────────────────────────────────
  console.log('\n2) Estructura')
  const tablas = await todas(`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN
       ('ronda_turnos','ronda_rutas','ronda_ruta_paradas',
        'persona_ubicacion_actual','persona_ubicacion_historial')`)
  check('las 5 tablas existen', tablas.length === 5, `${tablas.length}/5`)
  check('todas con RLS activa', tablas.every((t) => t.relrowsecurity))

  const nul = async (t, col) => (await una(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`, [t, col]))?.is_nullable
  check('§2.4: grupo_id NOT NULL en las cuatro tablas de la fase',
    (await nul('ronda_rutas', 'grupo_id')) === 'NO'
    && (await nul('ronda_ruta_paradas', 'grupo_id')) === 'NO'
    && (await nul('persona_ubicacion_actual', 'grupo_id')) === 'NO'
    && (await nul('persona_ubicacion_historial', 'grupo_id')) === 'NO')
  check('§2.4: sede_id NOT NULL en las rutas y NULLABLE en la ubicación',
    (await nul('ronda_rutas', 'sede_id')) === 'NO'
    && (await nul('ronda_ruta_paradas', 'sede_id')) === 'NO'
    && (await nul('persona_ubicacion_actual', 'sede_id')) === 'YES'
    && (await nul('persona_ubicacion_historial', 'sede_id')) === 'YES')
  check('R1 en el esquema: turno_id es NOT NULL en las dos tablas de ubicación',
    (await nul('persona_ubicacion_actual', 'turno_id')) === 'NO'
    && (await nul('persona_ubicacion_historial', 'turno_id')) === 'NO')

  const idx = (await todas(`
    SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname='public'
       AND tablename IN ('persona_ubicacion_historial','persona_ubicacion_actual',
                         'ronda_turnos','ronda_ruta_paradas')`))
  const tieneIdx = (n) => idx.some((i) => i.indexname === n)
  check('el índice del replay (turno_id, capturado_at)', tieneIdx('idx_ubic_hist_turno'))
  check('el índice del día de una persona', tieneIdx('idx_ubic_hist_persona'))
  check('la purga usa BRIN, no B-tree',
    idx.some((i) => i.indexname === 'idx_ubic_hist_purga' && /USING brin/i.test(i.indexdef)))
  check('un solo turno abierto por persona (índice único parcial)',
    idx.some((i) => i.indexname === 'ux_ronda_turnos_abierto'
                 && /WHERE \(?\(?estado/i.test(i.indexdef)))
  check('un número de parada único por ruta', tieneIdx('ux_ronda_paradas_numero'))

  check('persona_ubicacion_actual está en la publicación de realtime',
    (await todas(`SELECT 1 FROM pg_publication_tables
                   WHERE pubname='supabase_realtime' AND schemaname='public'
                     AND tablename='persona_ubicacion_actual'`)).length === 1)

  check('grupo_reglas ganó los parámetros de la fase',
    (await todas(`SELECT column_name FROM information_schema.columns
                   WHERE table_schema='public' AND table_name='grupo_reglas'
                     AND column_name IN ('ubicacion_frescura_seg','ubicacion_intervalo_seg',
                       'ubicacion_max_puntos_turno','retencion_ubicacion_meses',
                       'ubicacion_visible_cliente','turno_duracion_max_horas')`)).length === 6)
  check('la retención de ubicación es un PARÁMETRO y por defecto 3 meses (no 12)',
    (await una(`SELECT column_default FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='grupo_reglas'
                   AND column_name='retencion_ubicacion_meses'`))?.column_default?.startsWith('3'))
  check('SEGUIMIENTO es un tipo de consentimiento APARTE de UBICACION',
    /SEGUIMIENTO/.test((await una(`
      SELECT pg_get_constraintdef(k.oid) d FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid
       WHERE t.relname='persona_consentimientos' AND pg_get_constraintdef(k.oid) LIKE '%BIOMETRIA%'`))?.d ?? ''))

  const lecturas = await todas(`
    SELECT tablename, policyname, qual FROM pg_policies
     WHERE schemaname='public' AND cmd='SELECT'
       AND tablename IN ('ronda_turnos','ronda_rutas','ronda_ruta_paradas',
                         'persona_ubicacion_actual','persona_ubicacion_historial')`)
  check('las 5 políticas de LECTURA existen y exigen permiso', lecturas.length === 5
    && lecturas.every((p) => /auth_permiso|ronda_mapa_acceso|ronda_ubicacion_puede_ver|ronda_recorrido_acceso/.test(p.qual)),
    `${lecturas.length} políticas`)
  // Guardia contra el hueco de 20261028000811: las dos lecturas de ubicación y
  // las dos funciones del replay tienen que preguntar por el flag del contrato.
  // Si alguien vuelve a escribir una de las cuatro sin él, esto falla.
  check('las 2 políticas de ubicación exigen el flag del contrato',
    lecturas.filter((p) => p.tablename.startsWith('persona_ubicacion')
      && /ronda_seguimiento_activo/.test(p.qual)).length === 2)
  check('y las 2 funciones del replay también',
    (await todas(`
      SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname IN ('ronda_recorrido','ronda_turnos_recorribles')
         AND pg_get_functiondef(p.oid) LIKE '%ronda_seguimiento_activo%'`)).length === 2)
  check('la ubicación NO tiene ninguna política de escritura (solo por RPC)',
    (await todas(`SELECT 1 FROM pg_policies WHERE schemaname='public'
                   AND tablename IN ('persona_ubicacion_actual','persona_ubicacion_historial')
                   AND cmd <> 'SELECT'`)).length === 0)

  // ── 3. Datos de prueba (dentro de la transacción) ─────────────────────────
  console.log('\n3) Datos de prueba')
  await comoDueno()
  const g1 = (await una(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, activo)
    VALUES ('ZZF8A', 'Contrato de prueba F8 A', 'VIGENTE', CURRENT_DATE - 30, true)
    RETURNING id`)).id
  const g2 = (await una(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, activo)
    VALUES ('ZZF8B', 'Contrato de prueba F8 B', 'VIGENTE', CURRENT_DATE - 30, true)
    RETURNING id`)).id
  const s1 = (await una(`
    INSERT INTO sedes (nombre, ciudad, grupo_id, lat, lng)
    VALUES ('Sede de prueba F8 A', 'Bogota', $1, 4.6800000, -74.0500000) RETURNING id`, [g1])).id
  const s2 = (await una(`
    INSERT INTO sedes (nombre, ciudad, grupo_id, lat, lng)
    VALUES ('Sede de prueba F8 B', 'Bogota', $1, 4.7000000, -74.0600000) RETURNING id`, [g2])).id
  // Reglas: A permite el seguimiento; B NO (es el valor por defecto).
  await c.query(`INSERT INTO grupo_reglas (grupo_id, comparte_seguimiento_vivo, ubicacion_intervalo_seg,
                   ubicacion_frescura_seg, ubicacion_max_puntos_turno, retencion_ubicacion_meses)
                 VALUES ($1, true, 60, 300, 20, 3)`, [g1])
  await c.query(`INSERT INTO grupo_reglas (grupo_id, comparte_seguimiento_vivo) VALUES ($1, false)`, [g2])

  const pA = (await una(`
    INSERT INTO personas (documento, nombres, apellidos, estado)
    VALUES ('ZZF8-0001', 'Persona', 'Prueba Uno', 'ACTIVO') RETURNING id`)).id
  const pB = (await una(`
    INSERT INTO personas (documento, nombres, apellidos, estado)
    VALUES ('ZZF8-0002', 'Persona', 'Prueba Dos', 'ACTIVO') RETURNING id`)).id
  const pC = (await una(`
    INSERT INTO personas (documento, nombres, apellidos, estado)
    VALUES ('ZZF8-0003', 'Persona', 'Prueba Tres', 'ACTIVO') RETURNING id`)).id

  const consentir = async (persona, tipo) => c.query(`
    INSERT INTO persona_consentimientos (persona_id, tipo, otorgado, texto_version, texto_hash)
    VALUES ($1, $2, true, 'prueba 1', repeat('a', 64))`, [persona, tipo])
  await consentir(pA, 'SEGUIMIENTO'); await consentir(pA, 'UBICACION')
  await consentir(pB, 'SEGUIMIENTO'); await consentir(pB, 'UBICACION')
  // pC NO consiente a propósito.

  // Dos zonas y dos puntos para las rutas.
  const z1 = (await una(`
    INSERT INTO ronda_zonas (grupo_id, sede_id, codigo, nombre) VALUES ($1,$2,'ZZF8-Z1','Zona 1')
    RETURNING id`, [g1, s1])).id
  const punto = async (cod, clave, nombre, lat, lng) => (await una(`
    INSERT INTO ronda_puntos (grupo_id, sede_id, zona_id, codigo, clave_publica, nombre,
                              descripcion, lat, lng, estado)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'ACTIVO') RETURNING id`,
    [g1, s1, z1, cod, clave, nombre, 'Al fondo a la derecha', lat, lng])).id
  const pt1 = await punto('ZZF8-P1', 'ZZF8AAA1', 'Punto uno', 4.6801, -74.0501)
  const pt2 = await punto('ZZF8-P2', 'ZZF8AAA2', 'Punto dos', 4.6805, -74.0505)
  const pt3 = await punto('ZZF8-P3', 'ZZF8AAA3', 'Punto tres', 4.6810, -74.0510)
  check('datos de prueba creados', !!(g1 && g2 && s1 && s2 && pA && pB && pt1 && pt2 && pt3))

  // ── 4. R1: fuera de turno no se registra ──────────────────────────────────
  console.log('\n4) R1 — fuera del turno no se registra la ubicación de nadie')
  const antesEventos = Number((await una(
    `SELECT count(*) n FROM ronda_eventos WHERE accion='UBICACION_RECHAZADA'`)).n)

  const sinTurno = (await una(`
    SELECT ronda_registrar_ubicacion(4.68, -74.05, 10, NULL, NULL, 'APP_VIVO',
                                     NULL, NULL, NULL, $1, NULL) j`, [pA])).j
  check('sin turno abierto, la ubicación se RECHAZA',
    sinTurno.estado === 'RECHAZADA' && sinTurno.motivo === 'SIN_TURNO', sinTurno.mensaje)
  check('y no dejó NINGÚN rastro parcial',
    Number((await una(`SELECT count(*) n FROM persona_ubicacion_historial WHERE persona_id=$1`, [pA])).n) === 0
    && Number((await una(`SELECT count(*) n FROM persona_ubicacion_actual WHERE persona_id=$1`, [pA])).n) === 0)

  // Abrir turno y registrar.
  const t1 = (await una(`SELECT (ronda_turno_abrir($1, NULL, NULL, NULL, 'CONSOLA', NULL, $2, NULL)).id`,
    [s1, pA])).id
  check('se abrió el turno', !!t1)
  const t1bis = (await una(`SELECT (ronda_turno_abrir($1, NULL, NULL, NULL, 'CONSOLA', NULL, $2, NULL)).id`,
    [s1, pA])).id
  check('abrir dos veces devuelve el MISMO turno (idempotente)', t1 === t1bis)

  // Una lectura de ANTES del inicio del turno se acota al inicio: una posición
  // de antes del turno no es una posición del turno (R1 y R2 a la vez). Se
  // prueba con el turno recién abierto, que es cuando el acotado se nota.
  const r0 = (await una(`
    SELECT ronda_registrar_ubicacion(4.6800, -74.0500, 8, NULL, NULL, 'APP_VIVO',
                                     NOW() - interval '2 hours', NULL, NULL, $1, NULL) j`, [pA])).j
  check('con turno abierto y consentimiento, se REGISTRA', r0.estado === 'REGISTRADA')
  const acotada = (await una(`
    SELECT h.capturado_at >= t.inicio_at ok
      FROM persona_ubicacion_historial h JOIN ronda_turnos t ON t.id = h.turno_id
     WHERE h.persona_id = $1 ORDER BY h.id DESC LIMIT 1`, [pA])).ok
  check('capturado_at nunca queda antes del inicio del turno', acotada === true)

  // Contrato que NO permite el seguimiento.
  const tB = (await una(`SELECT (ronda_turno_abrir($1, NULL, NULL, NULL, 'CONSOLA', NULL, $2, NULL)).id`,
    [s2, pB])).id
  const noPermite = (await una(`
    SELECT ronda_registrar_ubicacion(4.70, -74.06, 10, NULL, NULL, 'APP_VIVO',
                                     NULL, NULL, NULL, $1, NULL) j`, [pB])).j
  check('con turno abierto pero contrato SIN seguimiento en vivo, se RECHAZA',
    noPermite.estado === 'RECHAZADA' && noPermite.motivo === 'CONTRATO_NO_PERMITE', noPermite.mensaje)
  check('y tampoco dejó rastro',
    Number((await una(`SELECT count(*) n FROM persona_ubicacion_historial WHERE persona_id=$1`, [pB])).n) === 0)

  // Sin consentimiento.
  const tC = (await una(`SELECT (ronda_turno_abrir($1, NULL, NULL, NULL, 'CONSOLA', NULL, $2, NULL)).id`,
    [s1, pC])).id
  const sinCons = (await una(`
    SELECT ronda_registrar_ubicacion(4.68, -74.05, 10, NULL, NULL, 'APP_VIVO',
                                     NULL, NULL, NULL, $1, NULL) j`, [pC])).j
  check('sin consentimiento de SEGUIMIENTO, se RECHAZA',
    sinCons.estado === 'RECHAZADA' && sinCons.motivo === 'SIN_CONSENTIMIENTO_SEGUIMIENTO',
    sinCons.mensaje)

  // Y el rechazo queda AUDITADO: si la RPC lanzara excepción, el INSERT de la
  // auditoría se iría con ella y el intento no dejaría rastro en ningún lado.
  check('los tres rechazos quedaron auditados en ronda_eventos',
    Number((await una(`SELECT count(*) n FROM ronda_eventos WHERE accion='UBICACION_RECHAZADA'`)).n)
      === antesEventos + 3,
    `${Number((await una(`SELECT count(*) n FROM ronda_eventos WHERE accion='UBICACION_RECHAZADA'`)).n) - antesEventos} eventos`)

  // Turno vencido: la ubicación se rechaza aunque el estado siga ABIERTO.
  await c.query(`UPDATE ronda_turnos
                    SET inicio_at = NOW() - interval '9 hours',
                        fin_previsto_at = NOW() - interval '1 minute'
                  WHERE id=$1`, [tC])
  check('un turno cuya hora de fin ya pasó NO cuenta como abierto',
    (await una(`SELECT ronda_turno_abierto($1) t`, [pC])).t === null)
  const vencido = (await una(`
    SELECT ronda_registrar_ubicacion(4.68, -74.05, 10, NULL, NULL, 'APP_VIVO',
                                     NULL, NULL, NULL, $1, NULL) j`, [pC])).j
  check('y su ubicación se rechaza aunque nadie haya cerrado el turno',
    vencido.estado === 'RECHAZADA' && vencido.motivo === 'SIN_TURNO')

  // ── 5. Volumen ────────────────────────────────────────────────────────────
  console.log('\n5) Volumen — intervalo, orden y tope por turno')
  // Ojo con la trampa de probar esto dentro de una transacción: `NOW()` es la
  // hora de INICIO de la transacción y no avanza, así que las lecturas hay que
  // fecharlas a mano. Se retrasa el inicio del turno para poder hacerlo, que es
  // lo que pasa de verdad en un turno de 8 horas.
  await c.query(`UPDATE ronda_turnos SET inicio_at = NOW() - interval '8 hours' WHERE id=$1`, [t1])
  await c.query(`DELETE FROM persona_ubicacion_historial WHERE turno_id=$1`, [t1])
  await c.query(`DELETE FROM persona_ubicacion_actual WHERE turno_id=$1`, [t1])
  await c.query(`UPDATE ronda_turnos SET puntos_registrados=0, metros_recorridos=0,
                   primera_lat=NULL, primera_lng=NULL, ultima_lat=NULL, ultima_lng=NULL
                 WHERE id=$1`, [t1])

  const base = (await una(`
    SELECT ronda_registrar_ubicacion(4.6800, -74.0500, 8, NULL, NULL, 'APP_VIVO',
                                     NOW() - interval '7 hours', NULL, NULL, $1, NULL) j`, [pA])).j
  check('la primera lectura del turno se registra', base.estado === 'REGISTRADA')

  const pronto = (await una(`
    SELECT ronda_registrar_ubicacion(4.6801, -74.0501, 8, NULL, NULL, 'APP_VIVO',
                                     NOW() - interval '7 hours' + interval '10 seconds',
                                     NULL, NULL, $1, NULL) j`, [pA])).j
  check('un punto antes del intervalo mínimo se IGNORA sin error', pronto.estado === 'IGNORADA'
    && pronto.motivo === 'INTERVALO', `${pronto.motivo} · faltan ${pronto.proximo_en_seg} s`)

  const viejo = (await una(`
    SELECT ronda_registrar_ubicacion(4.6802, -74.0502, 8, NULL, NULL, 'APP_VIVO',
                                     NOW() - interval '7 hours 30 minutes', NULL, NULL, $1, NULL) j`, [pA])).j
  check('una lectura más vieja que la última se IGNORA (cola fuera de orden)',
    viejo.estado === 'IGNORADA' && viejo.motivo === 'FUERA_DE_ORDEN', viejo.motivo)
  check('y la posición en vivo NO se pisó con la vieja',
    Number((await una(`SELECT round(EXTRACT(EPOCH FROM (NOW() - capturado_at))) s
                        FROM persona_ubicacion_actual WHERE persona_id=$1`, [pA])).s) <= 7 * 3600)

  // Rellenar el turno hasta el tope (20 en este contrato de prueba). Van hacia
  // adelante en el tiempo, separadas más del intervalo mínimo de 60 s.
  for (let i = 1; i <= 25; i++) {
    await c.query(`
      SELECT ronda_registrar_ubicacion($2, $3, 8, NULL, NULL, 'APP_VIVO',
                                       NOW() - interval '7 hours' + ($4 || ' seconds')::interval,
                                       NULL, NULL, $1, NULL)`,
      [pA, 4.68 + i * 0.0001, -74.05 - i * 0.0001, i * 70])
  }
  const tope = (await una(`
    SELECT ronda_registrar_ubicacion(4.69, -74.06, 8, NULL, NULL, 'APP_VIVO',
                                     NOW() - interval '1 hour', NULL, NULL, $1, NULL) j`, [pA])).j
  check('pasado el tope del turno se IGNORA', tope.estado === 'IGNORADA' && tope.motivo === 'TOPE_TURNO',
    `${tope.estado} / ${tope.motivo}`)
  const resumen = await una(`SELECT puntos_registrados, metros_recorridos, ultima_posicion_at
                               FROM ronda_turnos WHERE id=$1`, [t1])
  check('el turno lleva su propio contador (no hay COUNT sobre el historial)',
    Number(resumen.puntos_registrados) === 20, `${resumen.puntos_registrados} puntos`)
  check('y su resumen de metros recorridos', Number(resumen.metros_recorridos) > 0,
    `${resumen.metros_recorridos} m`)

  // ── 6. R2: la antigüedad la calcula el servidor ───────────────────────────
  console.log('\n6) R2 — el mapa nunca muestra una posición vieja como si fuera actual')
  // Un usuario con permisos sobre el contrato A.
  await comoDueno()
  const rolId = (await una(`
    INSERT INTO roles (nombre, permisos, activo)
    VALUES ('ZZF8_SUPERVISOR', '{"ver_mapa_operativo":true,"ver_recorrido_personas":true,"ver_rutas_ronda":true,"gestionar_rutas_ronda":true}'::jsonb, true)
    RETURNING id`)).id
  const authA = (await una(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'zzf8a@prueba.local')
    RETURNING id`)).id
  const authB = (await una(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'zzf8b@prueba.local')
    RETURNING id`)).id
  const usuario = async (id, email, nombre, rol, grupo) => c.query(`
    INSERT INTO usuarios (id, email, nombre, rol, rol_id, grupo_id, activo)
    VALUES ($1, $2, $3, 'SUPERVISOR', $4, $5, true)
    ON CONFLICT (id) DO UPDATE SET rol_id = EXCLUDED.rol_id, grupo_id = EXCLUDED.grupo_id,
      rol = EXCLUDED.rol, activo = true`, [id, email, nombre, rol, grupo])
  await usuario(authA, 'zzf8a@prueba.local', 'Supervisor A', rolId, g1)
  await usuario(authB, 'zzf8b@prueba.local', 'Supervisor B', rolId, g2)

  // La última lectura del turno de prueba es de hace horas (se rellenó hacia
  // atrás): para probar el caso «recién capturada» se pone al día.
  await c.query(`UPDATE persona_ubicacion_actual SET capturado_at = NOW() WHERE persona_id=$1`, [pA])

  await como(authA)
  const mapa = await todas(`SELECT * FROM ronda_mapa_personas(NULL, NULL)`)
  check('el mapa devuelve a la persona en turno del contrato A', mapa.length === 1,
    `${mapa.length} personas`)
  check('y trae antiguedad_seg, fuente, frescura_seg y en_vivo',
    mapa[0] && mapa[0].antiguedad_seg !== null && !!mapa[0].fuente
    && mapa[0].frescura_seg !== null && mapa[0].en_vivo !== null)
  check('la antigüedad la calculó el SERVIDOR, no el cliente',
    Number(mapa[0].antiguedad_seg) >= 0 && Number(mapa[0].antiguedad_seg) < 3600,
    `${mapa[0].antiguedad_seg} s`)
  check('con una posición reciente, en_vivo = true', mapa[0].en_vivo === true)

  await comoDueno()
  await c.query(`UPDATE persona_ubicacion_actual SET capturado_at = NOW() - interval '40 minutes'
                  WHERE persona_id=$1`, [pA])
  await como(authA)
  const viejaFila = (await todas(`SELECT * FROM ronda_mapa_personas(NULL, NULL)`))[0]
  check('una posición de 40 minutos sale con en_vivo = false (estilo «último registro»)',
    viejaFila.en_vivo === false && Number(viejaFila.antiguedad_seg) > 2300,
    `${viejaFila.antiguedad_seg} s`)
  check('y sigue trayendo su fuente, para poder rotular «hace 40 min · …»',
    viejaFila.fuente === 'APP_VIVO')

  // ── 7. Alcance por contrato ───────────────────────────────────────────────
  console.log('\n7) Alcance por contrato y por el interruptor del contrato')
  await como(authB)
  check('el usuario del contrato B no ve a nadie del contrato A',
    (await todas(`SELECT * FROM ronda_mapa_personas(NULL, NULL)`)).length === 0)
  check('ni lee su fila de ubicación por la tabla',
    (await todas(`SELECT * FROM persona_ubicacion_actual`)).length === 0)

  await comoDueno()
  await c.query(`UPDATE grupo_reglas SET comparte_seguimiento_vivo=false WHERE grupo_id=$1`, [g1])
  await como(authA)
  check('apagar comparte_seguimiento_vivo apaga el mapa SIN borrar filas',
    (await todas(`SELECT * FROM ronda_mapa_personas(NULL, NULL)`)).length === 0)
  check('y apaga también la lectura directa de la tabla',
    (await todas(`SELECT * FROM persona_ubicacion_actual`)).length === 0)
  await comoDueno()
  check('las filas siguen ahí (no se borró nada)',
    Number((await una(`SELECT count(*) n FROM persona_ubicacion_actual WHERE persona_id=$1`, [pA])).n) === 1)
  await c.query(`UPDATE grupo_reglas SET comparte_seguimiento_vivo=true WHERE grupo_id=$1`, [g1])

  // ── 8. Cerrar turno: desaparece del mapa, el rastro queda ─────────────────
  console.log('\n8) Al cerrar el turno la persona sale del mapa y su rastro queda')
  const hist = Number((await una(
    `SELECT count(*) n FROM persona_ubicacion_historial WHERE turno_id=$1`, [t1])).n)
  await comoDueno()
  await c.query(`SELECT ronda_turno_cerrar($1, $2, NULL)`, [t1, pA])
  check('la fila de posición actual se borró',
    Number((await una(`SELECT count(*) n FROM persona_ubicacion_actual WHERE turno_id=$1`, [t1])).n) === 0)
  check('el rastro del turno sigue completo en el historial',
    Number((await una(`SELECT count(*) n FROM persona_ubicacion_historial WHERE turno_id=$1`, [t1])).n) === hist,
    `${hist} puntos`)
  await como(authA)
  check('y el mapa ya no la muestra',
    (await todas(`SELECT * FROM ronda_mapa_personas(NULL, NULL)`)).length === 0)
  const resumenCerrado = await una(`SELECT puntos_registrados, metros_recorridos FROM ronda_turnos WHERE id=$1`, [t1])
  check('el resumen del turno sobrevive al cierre', Number(resumenCerrado.puntos_registrados) === 20)

  // ── 9. Replay ─────────────────────────────────────────────────────────────
  console.log('\n9) Replay del recorrido, diezmado en SQL')
  const completo = await todas(`SELECT * FROM ronda_recorrido($1, 5000)`, [t1])
  check('el recorrido completo trae los 20 puntos', completo.length === 20, `${completo.length}`)
  const diezmado = await todas(`SELECT * FROM ronda_recorrido($1, 5)`, [t1])
  check('pidiendo 5 puntos, devuelve bastantes menos de 20', diezmado.length < 20 && diezmado.length >= 2,
    `${diezmado.length} puntos`)
  check('el PRIMERO y el ÚLTIMO están siempre',
    diezmado[0].capturado_at.getTime() === completo[0].capturado_at.getTime()
    && diezmado[diezmado.length - 1].capturado_at.getTime()
       === completo[completo.length - 1].capturado_at.getTime())
  check('y viene en orden de tiempo',
    diezmado.every((p, i) => i === 0 || p.capturado_at >= diezmado[i - 1].capturado_at))
  check('el selector de turnos recorribles trae el turno con su resumen',
    (await todas(`SELECT * FROM ronda_turnos_recorribles(NULL,NULL,NULL,NULL,100)`))
      .some((t) => t.turno_id === t1))

  // El replay pide su propia clave, más restrictiva que la del mapa.
  await comoDueno()
  const rolMapa = (await una(`
    INSERT INTO roles (nombre, permisos, activo)
    VALUES ('ZZF8_SOLO_MAPA', '{"ver_mapa_operativo":true}'::jsonb, true) RETURNING id`)).id
  const authM = (await una(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'zzf8m@prueba.local') RETURNING id`)).id
  await usuario(authM, 'zzf8m@prueba.local', 'Solo mapa', rolMapa, g1)
  await como(authM)
  const soloMapa = await enSavepoint(() => c.query(`SELECT * FROM ronda_recorrido($1, 100)`, [t1]))
  check('con solo ver_mapa_operativo NO se puede reproducir un recorrido', !soloMapa.ok,
    soloMapa.error?.slice(0, 50))
  check('ni leer el historial por la tabla',
    (await todas(`SELECT * FROM persona_ubicacion_historial`)).length === 0)

  // ── 10. Rutas y la próxima parada (F10) ───────────────────────────────────
  console.log('\n10) Rutas, paradas y ronda_proxima_parada() — el gancho de F10')
  await como(authA)
  const ruta = await una(`
    INSERT INTO ronda_rutas (grupo_id, sede_id, nombre, fecha, persona_id, estado)
    VALUES ($1,$2,'Ronda de prueba', (NOW() AT TIME ZONE 'America/Bogota')::date, $3, 'EN_CURSO')
    RETURNING id, codigo`, [g1, s1, pA])
  check('la ruta se numeró desde la SEQUENCE', /^RR-\d{6}$/.test(ruta.codigo), ruta.codigo)
  const par = async (punto, n) => (await una(`
    INSERT INTO ronda_ruta_paradas (ruta_id, punto_id, numero_parada, hora_estimada)
    VALUES ($1,$2,$3,'08:00') RETURNING id, grupo_id, sede_id`, [ruta.id, punto, n]))
  const pa1 = await par(pt1, 1); const pa2 = await par(pt2, 2); const pa3 = await par(pt3, 3)
  check('la parada derivó grupo_id y sede_id de su punto (no los recibió)',
    pa1.grupo_id === g1 && pa1.sede_id === s1)

  const cruzada = await enSavepoint(async () => {
    await comoDueno()
    const ptOtro = (await una(`
      INSERT INTO ronda_zonas (grupo_id, sede_id, codigo, nombre) VALUES ($1,$2,'ZZF8-Z2','Zona B')
      RETURNING id`, [g2, s2])).id
    const p = (await una(`
      INSERT INTO ronda_puntos (grupo_id, sede_id, zona_id, codigo, clave_publica, nombre, estado)
      VALUES ($1,$2,$3,'ZZF8-PB','ZZF8BBB1','Punto de B','ACTIVO') RETURNING id`, [g2, s2, ptOtro])).id
    return c.query(`INSERT INTO ronda_ruta_paradas (ruta_id, punto_id, numero_parada)
                    VALUES ($1,$2,9)`, [ruta.id, p])
  })
  await como(authA)
  check('una parada de OTRO contrato en la misma ruta se rechaza', !cruzada.ok,
    cruzada.error?.slice(0, 60))

  const prox1 = (await una(`SELECT ronda_proxima_parada($1) j`, [pA])).j
  check('la próxima parada es la 1', prox1.estado === 'PARADA' && prox1.parada.numero === 1,
    `${prox1.estado} / ${prox1.parada?.numero}`)
  check('y trae el punto con su «cómo llegar» y sus coordenadas',
    prox1.punto.nombre === 'Punto uno' && !!prox1.punto.como_llegar
    && prox1.punto.lat !== null && prox1.punto.lng !== null)
  check('y cuántas paradas quedan pendientes', prox1.paradas_pendientes === 3)

  await comoDueno()
  await c.query(`UPDATE ronda_ruta_paradas SET estado='CUMPLIDA', llegado_at=NOW() WHERE id=$1`, [pa1.id])
  const prox2 = (await una(`SELECT ronda_proxima_parada($1) j`, [pA])).j
  check('cumplida la 1, la próxima es la 2', prox2.parada.numero === 2)
  await c.query(`UPDATE ronda_ruta_paradas SET estado='CUMPLIDA', llegado_at=NOW()
                  WHERE id IN ($1,$2)`, [pa2.id, pa3.id])
  const prox3 = (await una(`SELECT ronda_proxima_parada($1) j`, [pA])).j
  check('sin paradas pendientes, el estado es RUTA_TERMINADA', prox3.estado === 'RUTA_TERMINADA')
  const prox4 = (await una(`SELECT ronda_proxima_parada($1) j`, [pB])).j
  check('una persona sin ruta de hoy devuelve SIN_RUTA', prox4.estado === 'SIN_RUTA')

  // Reordenar.
  await c.query(`UPDATE ronda_ruta_paradas SET estado='PENDIENTE', llegado_at=NULL WHERE ruta_id=$1`, [ruta.id])
  await como(authA)
  const n = (await una(`SELECT ronda_ruta_ordenar($1, ARRAY[$2,$3,$4]::uuid[]) n`,
    [ruta.id, pa3.id, pa1.id, pa2.id])).n
  check('reordenar las 3 paradas no choca con el índice único', Number(n) === 3)
  const orden = await todas(`SELECT id, numero_parada FROM ronda_ruta_paradas
                              WHERE ruta_id=$1 ORDER BY numero_parada`, [ruta.id])
  check('y quedaron en el orden pedido',
    orden[0].id === pa3.id && orden[1].id === pa1.id && orden[2].id === pa2.id)
  const incompleta = await enSavepoint(() => c.query(
    `SELECT ronda_ruta_ordenar($1, ARRAY[$2]::uuid[])`, [ruta.id, pa1.id]))
  check('ordenar con una lista incompleta se rechaza', !incompleta.ok)

  // ── 11. Purga y cierre automático ─────────────────────────────────────────
  console.log('\n11) Retención y cierre automático (las dos tareas del cron)')
  await comoDueno()
  await c.query(`UPDATE persona_ubicacion_historial
                    SET capturado_at = NOW() - interval '4 months'
                  WHERE turno_id=$1 AND id IN (
                    SELECT id FROM persona_ubicacion_historial WHERE turno_id=$1 ORDER BY id LIMIT 7)`, [t1])
  const borradas = Number((await una(`SELECT ronda_purgar_ubicacion(1000) n`)).n)
  check('la purga borró el rastro de más de 3 meses (la retención del contrato)',
    borradas === 7, `${borradas} filas`)
  check('y dejó el resto',
    Number((await una(`SELECT count(*) n FROM persona_ubicacion_historial WHERE turno_id=$1`, [t1])).n) === 13)
  const trasPurga = await una(`SELECT puntos_registrados, metros_recorridos FROM ronda_turnos WHERE id=$1`, [t1])
  check('el resumen del turno SOBREVIVE a la purga',
    Number(trasPurga.puntos_registrados) === 20 && Number(trasPurga.metros_recorridos) > 0,
    `${trasPurga.puntos_registrados} puntos · ${trasPurga.metros_recorridos} m`)

  const cerrados = Number((await una(`SELECT ronda_turnos_cerrar_vencidos(500) n`)).n)
  check('el cron cerró los turnos vencidos', cerrados >= 1, `${cerrados} turnos`)
  check('y ninguno quedó abierto con la hora pasada',
    Number((await una(`SELECT count(*) n FROM ronda_turnos
                        WHERE estado='ABIERTO' AND fin_previsto_at < NOW()`)).n) === 0)

  // ── 12. Lo propio siempre se ve ───────────────────────────────────────────
  console.log('\n12) Lo propio: la persona ve lo que se registró de ella')
  await comoDueno()
  const authP = (await una(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(), 'zzf8p@prueba.local') RETURNING id`)).id
  const rolNada = (await una(`
    INSERT INTO roles (nombre, permisos, activo) VALUES ('ZZF8_SIN_NADA','{}'::jsonb,true) RETURNING id`)).id
  await usuario(authP, 'zzf8p@prueba.local', 'La persona', rolNada, null)
  await c.query(`UPDATE personas SET usuario_id=$1 WHERE id=$2`, [authP, pA])
  await como(authP)
  check('sin ningún permiso, la persona SÍ lee su propio rastro',
    (await todas(`SELECT * FROM persona_ubicacion_historial`)).every((f) => f.persona_id === pA)
    && (await todas(`SELECT * FROM persona_ubicacion_historial`)).length === 13)
  check('y sus propios turnos',
    (await todas(`SELECT * FROM ronda_turnos`)).every((f) => f.persona_id === pA))

  // ── 13. `reportar_ubicacion_campo` sirve para algo ────────────────────────
  console.log('\n13) reportar_ubicacion_campo: mandar la propia ubicación sin ejecutar_rondas')
  await comoDueno()
  const rolRep = (await una(`
    INSERT INTO roles (nombre, permisos, activo)
    VALUES ('ZZF8_SOLO_REPORTA','{"reportar_ubicacion_campo":true}'::jsonb,true) RETURNING id`)).id
  const authR = (await una(`
    INSERT INTO auth.users (id, email) VALUES (gen_random_uuid(),'zzf8r@prueba.local') RETURNING id`)).id
  await usuario(authR, 'zzf8r@prueba.local', 'Solo reporta', rolRep, g1)
  const pR = (await una(`
    INSERT INTO personas (documento, nombres, apellidos, estado, usuario_id)
    VALUES ('ZZF8-0004','Persona','Prueba Cuatro','ACTIVO',$1) RETURNING id`, [authR])).id
  await consentir(pR, 'SEGUIMIENTO')
  const tR = (await una(`SELECT (ronda_turno_abrir($1, NULL, NULL, NULL, 'CONSOLA', NULL, $2, NULL)).id`,
    [s1, pR])).id
  check('se le abrió turno', !!tR)

  await como(authR)
  const propia = (await una(`
    SELECT ronda_registrar_ubicacion(4.6803, -74.0503, 7, NULL, NULL, 'APP_VIVO',
                                     NULL, NULL, NULL, NULL, NULL) j`)).j
  check('con solo reportar_ubicacion_campo, SÍ puede mandar la SUYA',
    propia.estado === 'REGISTRADA', `${propia.estado} ${propia.motivo ?? ''}`)
  const ajena = await enSavepoint(() => c.query(
    `SELECT ronda_registrar_ubicacion(4.6804, -74.0504, 7, NULL, NULL, 'APP_VIVO',
                                      NULL, NULL, NULL, $1, NULL)`, [pB]))
  check('pero NO la de otra persona', !ajena.ok, ajena.error?.slice(0, 50))

  // ── 14. El replay respeta el interruptor del contrato ────────────────────
  // El hueco que arregla 20261028000811: `ronda_recorrido()` y
  // `ronda_turnos_recorribles()` son SECURITY DEFINER, así que la RLS no se les
  // aplica, y por dentro no comprobaban `comparte_seguimiento_vivo`. Un
  // contrato que apagaba el seguimiento dejaba de mostrar el mapa en vivo pero
  // su rastro PASADO seguía reproduciéndose.
  //
  // Se prueban las DOS direcciones, porque esto es código en producción: que
  // encendido siga haciendo lo mismo que antes, y que apagado deje de hacerlo.
  console.log('\n14) El replay respeta comparte_seguimiento_vivo (20261028000811)')
  await comoDueno()
  await c.query(`UPDATE grupo_reglas SET comparte_seguimiento_vivo=true WHERE grupo_id=$1`, [g1])

  const recorribles = `SELECT * FROM ronda_turnos_recorribles(NULL,NULL,NULL,NULL,500)`
  await como(authA)
  const conFlag = await todas(`SELECT * FROM ronda_recorrido($1, 5000)`, [t1])
  check('ENCENDIDO: el replay devuelve el rastro del turno igual que antes',
    conFlag.length === 13, `${conFlag.length} puntos`)
  check('ENCENDIDO: el selector lista el turno',
    (await todas(recorribles)).some((t) => t.turno_id === t1))
  check('ENCENDIDO: y el historial se lee por la tabla',
    (await todas(`SELECT * FROM persona_ubicacion_historial`)).length > 0)

  // El mapa en vivo de quien SOLO tiene ver_mapa_operativo no se toca.
  await como(authM)
  const mapaOn = await todas(`SELECT * FROM ronda_mapa_personas(NULL, NULL)`)
  check('ENCENDIDO: el mapa en vivo de ver_mapa_operativo sigue mostrando a quien está en turno',
    mapaOn.length === 1 && mapaOn[0].persona_id === pR, `${mapaOn.length} personas`)

  // Y ahora el contrato retira el seguimiento.
  await comoDueno()
  await c.query(`UPDATE grupo_reglas SET comparte_seguimiento_vivo=false WHERE grupo_id=$1`, [g1])
  await como(authA)
  const negado = await enSavepoint(() => c.query(`SELECT * FROM ronda_recorrido($1, 5000)`, [t1]))
  check('APAGADO: ronda_recorrido() se niega', !negado.ok, negado.error?.slice(0, 60))
  check('APAGADO: y el mensaje dice que es el contrato, no un permiso que falte',
    /seguimiento/i.test(negado.error ?? ''))
  check('APAGADO: el selector ya no lista el turno',
    !(await todas(recorribles)).some((t) => t.turno_id === t1))
  check('APAGADO: ni se lee el historial por la tabla',
    (await todas(`SELECT * FROM persona_ubicacion_historial`)).length === 0)
  await como(authM)
  check('APAGADO: el mapa en vivo también se apaga (como ya hacía)',
    (await todas(`SELECT * FROM ronda_mapa_personas(NULL, NULL)`)).length === 0)

  // El dueño del dato no pierde su derecho porque el contrato cambie de idea.
  await como(authP)
  check('APAGADO: la persona SIGUE viendo su propio rastro (Ley 1581)',
    (await todas(`SELECT * FROM persona_ubicacion_historial`)).length === 13)

  // Y encenderlo otra vez lo devuelve: apagar no borró ni una fila.
  await comoDueno()
  await c.query(`UPDATE grupo_reglas SET comparte_seguimiento_vivo=true WHERE grupo_id=$1`, [g1])
  await como(authA)
  check('volver a encenderlo devuelve el replay intacto: apagar no borra nada',
    (await todas(`SELECT * FROM ronda_recorrido($1, 5000)`, [t1])).length === 13)

  // Lo que el arreglo NO debía hacer: abrir el replay a la clave del mapa.
  await como(authM)
  const soloMapaOtra = await enSavepoint(() => c.query(`SELECT * FROM ronda_recorrido($1, 100)`, [t1]))
  check('el arreglo no abrió la clave: con solo ver_mapa_operativo sigue sin poder reproducir',
    !soloMapaOtra.ok, soloMapaOtra.error?.slice(0, 50))
  check('y a ese le dice que le falta PERMISO, no que el contrato esté apagado',
    /permiso/i.test(soloMapaOtra.error ?? ''))
  check('el selector tampoco le devuelve turnos', (await todas(recorribles)).length === 0)

  // Un contrato sin fila de reglas no permite nada: es como está hoy la base.
  await comoDueno()
  const g3 = (await una(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, activo)
    VALUES ('ZZF8C', 'Contrato de prueba F8 C', 'VIGENTE', CURRENT_DATE - 30, true)
    RETURNING id`)).id
  check('un contrato SIN fila en grupo_reglas no permite el seguimiento',
    (await una(`SELECT ronda_seguimiento_activo($1) b`, [g3])).b === false)
  check('y con fila y el flag en true, sí',
    (await una(`SELECT ronda_seguimiento_activo($1) b`, [g1])).b === true)

  // ── La ventana hacia atrás del replay (20261028000813) ────────────────────
  // Que el selector esconda un turno viejo no basta: quien se haya guardado el
  // id lo reproduciría igual. Por eso se prueban las DOS puertas, y que subir
  // la ventana lo devuelva — la ventana acota lo que se mira, no borra nada.
  console.log('\n9) La ventana hacia atrás del replay')
  await comoDueno()
  check('un contrato sin número propio hereda los 30 días',
    (await una(`SELECT ronda_recorrido_ventana_dias($1) n`, [g3])).n === 30)
  check('y el de g1 también, que no lo ha cambiado nadie',
    (await una(`SELECT ronda_recorrido_ventana_dias($1) n`, [g1])).n === 30)

  await c.query(`UPDATE ronda_turnos SET inicio_at = now() - interval '45 days' WHERE id = $1`, [t1])
  await como(authA)
  check('un turno más viejo que la ventana desaparece del selector',
    (await todas(recorribles)).every((r) => r.turno_id !== t1))
  const fuera = await enSavepoint(() => c.query(`SELECT * FROM ronda_recorrido($1, 100)`, [t1]))
  check('y reproducirlo se niega aunque alguien se haya guardado el id', !fuera.ok,
    (fuera.error ?? '').slice(0, 70))
  check('el mensaje habla de la VENTANA, no de un permiso ni del contrato apagado',
    /ventana/i.test(fuera.error ?? '') && !/permiso|desactivado/i.test(fuera.error ?? ''))

  await comoDueno()
  await c.query(`UPDATE grupo_reglas SET recorrido_ventana_dias = 90 WHERE grupo_id = $1`, [g1])
  await como(authA)
  check('subir la ventana del contrato lo devuelve al selector: no se borró nada',
    (await todas(recorribles)).some((r) => r.turno_id === t1))
  check('y el replay vuelve a responder',
    (await todas(`SELECT * FROM ronda_recorrido($1, 5000)`, [t1])).length > 0)

  await comoDueno()
  const ventanaMala = await enSavepoint(() =>
    c.query(`UPDATE grupo_reglas SET recorrido_ventana_dias = 0 WHERE grupo_id = $1`, [g1]))
  check('una ventana de 0 días la rechaza la base', !ventanaMala.ok)

  console.log(`\n${fail === 0 ? 'TODO BIEN' : 'HAY FALLAS'} — ${ok} OK, ${fail} fallas`)
} catch (e) {
  console.error('\nERROR:', e.message)
  fail++
} finally {
  await c.query('ROLLBACK')
  await c.end()
}
process.exit(fail === 0 ? 0 : 1)

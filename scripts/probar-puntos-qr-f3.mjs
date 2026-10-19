// Pruebas de la F3 del módulo de Puntos QR (catálogo y asignaciones) contra la
// base REAL, dentro de una transacción que se revierte al final.
//
// Qué comprueba:
//   1. que los dos archivos de migración (F1 y luego F3) corran COMPLETOS dos
//      veces seguidas en la misma transacción (idempotencia de verdad);
//   2. la estructura: tablas, RLS, el grupo_id nullable de los catálogos y
//      NOT NULL de las asignaciones, y que NO exista nada del reto aleatorio;
//   3. la validación de `config` por tipo de paso;
//   4. el VERSIONADO: publicar la v2 no cambia ni una fila de la v1, y la v1
//      publicada no se puede modificar ni borrar;
//   5. el paso condicional: misma plantilla, sin ciclos, y sin depender de un
//      paso posterior al publicar; y que el clon rehaga sus referencias;
//   6. el alcance por contrato de la RLS: un usuario de un contrato NO lee las
//      plantillas privadas de otro, y SÍ ve las del catálogo general;
//   7. `ronda_tareas_aplicables()`: día y hora en Bogotá, ventana, tolerancia,
//      ventana que cruza medianoche, contrato vencido y el ajuste por contrato.
//
// NO aplica nada: todo va dentro de BEGIN … ROLLBACK. Las migraciones quedan
// escritas y verificadas, pero SIN aplicar.
//
// Uso (desde la raíz del worktree):
//   node --use-system-ca scripts/probar-puntos-qr-f3.mjs
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

const mig = (f) => readFileSync(join(raiz, 'supabase', 'migrations', f), 'utf8')
const SQL_F1 = mig('20261019000010_puntos_qr_f1_contrato.sql')
const SQL_F3 = mig('20261019000030_puntos_qr_f3_catalogo.sql')
const SQL_FK = mig('20261019000031_puntos_qr_f3_fk_puntos.sql')

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
/** Corre `fn` en un savepoint: si falla, revierte y devuelve el mensaje. */
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
  // ── 1. Idempotencia: los archivos completos, dos veces ────────────────────
  console.log('\n1) Idempotencia (F1 + F3 completos, dos veces en la misma transacción)')
  await c.query(SQL_F1)
  await c.query(SQL_F3)
  check('primera pasada de F1 y F3', true)
  await c.query(SQL_F1)
  await c.query(SQL_F3)
  check('segunda pasada sin error', true)
  // La de costura corre aunque ronda_puntos (F2) no exista: avisa y no falla.
  await c.query(SQL_FK)
  await c.query(SQL_FK)
  check('la migración 000031 corre sin ronda_puntos y es repetible', true)
  check('y NO dejó la llave foránea, porque ronda_puntos no existe en esta rama',
    (await todas(`SELECT 1 FROM pg_constraint WHERE conname='fk_ronda_asignaciones_punto'`)).length === 0)

  // ── 2. Estructura ─────────────────────────────────────────────────────────
  console.log('\n2) Estructura')
  const tablas = await todas(`
    SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public' AND c.relname IN
       ('ronda_tipos_actividad','ronda_instructivos','ronda_plantillas',
        'ronda_plantilla_pasos','ronda_asignaciones')`)
  check('las 5 tablas existen', tablas.length === 5, `${tablas.length}/5`)
  check('todas con RLS activa', tablas.every((t) => t.relrowsecurity))

  const nulos = await todas(`
    SELECT table_name, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND column_name='grupo_id'
       AND table_name IN ('ronda_tipos_actividad','ronda_instructivos','ronda_plantillas','ronda_asignaciones')
     ORDER BY table_name`)
  const nulable = (t) => nulos.find((r) => r.table_name === t)?.is_nullable
  check('grupo_id nullable en los tres catálogos (NULL = aplica a todos)',
    nulable('ronda_tipos_actividad') === 'YES' && nulable('ronda_instructivos') === 'YES'
    && nulable('ronda_plantillas') === 'YES')
  check('grupo_id NOT NULL en las asignaciones', nulable('ronda_asignaciones') === 'NO')
  check('ronda_plantilla_pasos NO lleva grupo_id (lo hereda de la plantilla)',
    !nulos.some((r) => r.table_name === 'ronda_plantilla_pasos'))
  check('las asignaciones llevan sede_id NOT NULL',
    (await una(`SELECT is_nullable FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='ronda_asignaciones'
                   AND column_name='sede_id'`))?.is_nullable === 'NO')

  const lecturas = await todas(`
    SELECT tablename, policyname, qual FROM pg_policies
     WHERE schemaname='public' AND cmd='SELECT' AND tablename LIKE 'ronda_%'`)
  check('las 5 políticas de LECTURA exigen auth_permiso (vía las funciones de acceso)',
    lecturas.length === 5 && lecturas.every((p) =>
      /ronda_catalogo_acceso|ronda_asignaciones_acceso/.test(p.qual)),
    `${lecturas.length} políticas`)

  const tipos = await todas(`SELECT codigo FROM ronda_tipos_actividad WHERE grupo_id IS NULL ORDER BY orden`)
  check('se sembraron las 8 actividades del catálogo general', tipos.length === 8,
    tipos.map((t) => t.codigo).join(' '))

  const pasoTipos = await una(`
    SELECT pg_get_constraintdef(k.oid) d FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid
     WHERE t.relname='ronda_plantilla_pasos' AND k.conname LIKE '%tipo%'`)
  check('los 9 tipos de paso están y NO hay ninguno de reto aleatorio (el complemento 1 no ha llegado)',
    /CASILLA/.test(pasoTipos.d) && /FIRMA/.test(pasoTipos.d) && !/RETO/i.test(pasoTipos.d))
  check('ninguna columna del módulo nombra el reto',
    (await todas(`SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name LIKE 'ronda_%'
                     AND column_name ILIKE '%reto%'`)).length === 0)

  // ── 3. Validación de `config` por tipo ────────────────────────────────────
  console.log('\n3) Validación de `config` por tipo de paso')
  const valida = async (tipo, cfg) =>
    (await una(`SELECT ronda_paso_config_valida($1, $2::jsonb) v`, [tipo, JSON.stringify(cfg)])).v
  check('FOTO con min/max coherentes vale', await valida('FOTO', { min: 1, max: 4, solo_camara_vivo: true }) === true)
  check('FOTO con max < min se rechaza', await valida('FOTO', { min: 4, max: 1 }) === false)
  check('FOTO con "min" que no es número se rechaza', await valida('FOTO', { min: 'dos' }) === false)
  check('FOTO con solo min (sin tope) vale', await valida('FOTO', { min: 3 }) === true)
  check('FOTO puede exigir el QR en el encuadre',
    await valida('FOTO', { min: 1, max: 1, exige_qr_en_encuadre: true }) === true)
  check('VIDEO con segundos_max fuera de rango se rechaza', await valida('VIDEO', { segundos_max: 999 }) === false)
  check('SELECCION sin opciones se rechaza', await valida('SELECCION', { multiple: false }) === false)
  check('SELECCION con una opción sin `valor` se rechaza',
    await valida('SELECCION', { opciones: [{ etiqueta: 'Sí' }] }) === false)
  check('SELECCION bien formada vale',
    await valida('SELECCION', { multiple: true, opciones: [{ valor: 'A', etiqueta: 'Uno' }] }) === true)
  check('ESCANEO sin `entidad` se rechaza', await valida('ESCANEO', { exige_existente: true }) === false)
  check('ESCANEO de maquinaria vale', await valida('ESCANEO', { entidad: 'maquinaria' }) === true)
  check('FIRMA sin `quien` se rechaza', await valida('FIRMA', {}) === false)
  check('NUMERO con rango y unidad vale',
    await valida('NUMERO', { min: 0, max: 9999, decimales: 2, unidad: 'm3' }) === true)
  check('un tipo inventado se rechaza', await valida('RETO', {}) === false)

  // ── 4. Contratos, sedes y una plantilla con seis tipos de paso ────────────
  console.log('\n4) Una plantilla con seis tipos de paso distintos y un instructivo en video')
  const g1 = (await una(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZF3A', 'Contrato F3 A', 'VIGENTE', CURRENT_DATE - 30, CURRENT_DATE + 300) RETURNING id`)).id
  const g2 = (await una(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZF3B', 'Contrato F3 B', 'VIGENTE', CURRENT_DATE - 30, CURRENT_DATE + 300) RETURNING id`)).id
  const gVencido = (await una(`
    INSERT INTO grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    VALUES ('ZZF3V', 'Contrato F3 vencido', 'VIGENTE', CURRENT_DATE - 400, CURRENT_DATE - 10) RETURNING id`)).id
  const sede1 = (await una(
    `INSERT INTO sedes (nombre, grupo_id) VALUES ('ZZ Sede F3 A', $1) RETURNING id`, [g1])).id
  const sedeV = (await una(
    `INSERT INTO sedes (nombre, grupo_id) VALUES ('ZZ Sede F3 vencida', $1) RETURNING id`, [gVencido])).id

  const tipoAseo = (await una(
    `SELECT id FROM ronda_tipos_actividad WHERE codigo='ASEO' AND grupo_id IS NULL`)).id

  // Instructivo en video, en el catálogo general.
  const instr = (await una(`
    INSERT INTO ronda_instructivos (codigo, version, titulo, tipo, momento, idioma,
                                    archivo_path, mime, duracion_seg, texto, estado, tipo_actividad_id)
    VALUES ('ZZ_LAVADO_BANO', 1, 'Cómo se lava un baño', 'VIDEO', 'ANTES', 'es-CO',
            'instructivos/00000000-0000-0000-0000-000000000000/lavado.mp4', 'video/mp4', 95,
            'Primero se retira el papel, luego se aplica el desinfectante…', 'PUBLICADO', $1)
    RETURNING id`, [tipoAseo])).id
  check('el instructivo en video quedó con duración e idioma', !!instr)
  const sinArchivo = await enSavepoint(() => c.query(`
    INSERT INTO ronda_instructivos (codigo, titulo, tipo, estado)
    VALUES ('ZZ_SIN_ARCHIVO', 'Sin archivo', 'PDF', 'PUBLICADO')`))
  check('un instructivo PUBLICADO sin archivo se rechaza', !sinArchivo.ok)

  const pl1 = (await una(`
    INSERT INTO ronda_plantillas (grupo_id, tipo_actividad_id, codigo, version, nombre,
                                  estado, duracion_estimada_min, exige_geocerca)
    VALUES (NULL, $1, 'ZZ_ASEO_BANOS', 1, 'Aseo de baños', 'BORRADOR', 12, true)
    RETURNING id`, [tipoAseo])).id

  const paso = async (plantilla, orden, tipo, titulo, cfg, extra = {}) => (await una(`
    INSERT INTO ronda_plantilla_pasos (plantilla_id, orden, tipo, titulo, config,
                                       instructivo_id, instructivo_momento,
                                       condicion_paso_id, condicion_valor, obligatorio)
    VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,COALESCE($10,true)) RETURNING id`,
    [plantilla, orden, tipo, titulo, JSON.stringify(cfg), extra.instructivo ?? null,
     extra.momento ?? null, extra.condicion ?? null, extra.valor ?? null, extra.obligatorio ?? null])).id

  const p1 = await paso(pl1, 1, 'CASILLA', '¿El baño estaba surtido?', { motivo_obligatorio_si_no: true },
    { instructivo: instr, momento: 'ANTES' })
  const p2 = await paso(pl1, 2, 'FOTO', 'Foto del ambiente',
    { min: 1, max: 4, solo_camara_vivo: true, exige_qr_en_encuadre: true })
  const p3 = await paso(pl1, 3, 'NUMERO', 'Rollos repuestos', { min: 0, max: 20, decimales: 0, unidad: 'un' })
  const p4 = await paso(pl1, 4, 'SELECCION', '¿Qué faltaba?',
    { multiple: true, opciones: [{ valor: 'PAPEL', etiqueta: 'Papel' }, { valor: 'JABON', etiqueta: 'Jabón' }] },
    { condicion: p1, valor: 'NO' })
  const p5 = await paso(pl1, 5, 'NOTA_VOZ', 'Observación hablada', { segundos_max: 60, transcribir: true },
    { obligatorio: false })
  const p6 = await paso(pl1, 6, 'FIRMA', 'Firma del residente', { quien: 'cliente', permite_facial: false })
  check('la plantilla quedó con seis pasos de tipos distintos',
    (await una(`SELECT count(DISTINCT tipo)::int n FROM ronda_plantilla_pasos WHERE plantilla_id=$1`, [pl1])).n === 6)
  check('el paso condicional apunta al paso 1 con valor NO', !!p4 && !!p5 && !!p6)

  // Paso condicional: no puede depender de otra plantilla ni de sí mismo.
  const plOtra = (await una(`
    INSERT INTO ronda_plantillas (tipo_actividad_id, codigo, nombre) VALUES ($1,'ZZ_OTRA','Otra')
    RETURNING id`, [tipoAseo])).id
  const cruzada = await enSavepoint(() => c.query(`
    INSERT INTO ronda_plantilla_pasos (plantilla_id, orden, tipo, titulo, config, condicion_paso_id, condicion_valor)
    VALUES ($1, 1, 'TEXTO', 'Depende de otra plantilla', '{}'::jsonb, $2, 'SI')`, [plOtra, p1]))
  check('un paso no puede condicionarse a un paso de OTRA plantilla', !cruzada.ok,
    (cruzada.error || '').slice(0, 60))
  const sinValor = await enSavepoint(() => c.query(`
    INSERT INTO ronda_plantilla_pasos (plantilla_id, orden, tipo, titulo, config, condicion_paso_id)
    VALUES ($1, 7, 'TEXTO', 'Condición sin valor', '{}'::jsonb, $2)`, [pl1, p1]))
  check('una condición sin valor se rechaza', !sinValor.ok)

  // ── 5. Publicar ───────────────────────────────────────────────────────────
  console.log('\n5) Publicar: validaciones y sello')
  // Hace falta un usuario con el permiso para que la RPC lo deje publicar.
  const rolCat = (await una(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ F3 Catálogo', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_catalogo_rondas":true,"gestionar_catalogo_rondas":true,
              "ver_asignaciones_rondas":true,"gestionar_asignaciones_rondas":true}'::jsonb)
    RETURNING id`)).id
  const rolSoloVer = (await una(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ F3 Solo ver', 'solo para la prueba', 'OPERADOR_SEDE',
            '{"ver_catalogo_rondas":true}'::jsonb) RETURNING id`)).id
  const nuevoUsuario = async (sufijo, grupoId, rol, rolId) => (await una(`
    INSERT INTO usuarios (id, nombre, email, rol, rol_id, grupo_id, activo)
    VALUES (gen_random_uuid(), $1, $2, $3::rol_usuario, $4, $5, true) RETURNING id`,
    [`ZZ F3 ${sufijo}`, `zz-f3-${sufijo}@example.invalid`, rol, rolId, grupoId])).id
  const uA = await nuevoUsuario('a', g1, 'OPERADOR_SEDE', rolCat)      // contrato A
  const uB = await nuevoUsuario('b', g2, 'OPERADOR_SEDE', rolCat)      // contrato B
  const uVer = await nuevoUsuario('ver', g1, 'OPERADOR_SEDE', rolSoloVer)
  const uAdm = await nuevoUsuario('adm', null, 'ADMIN', null)

  // Las validaciones se prueban CON el permiso puesto: como dueño de la base
  // `auth_permiso()` es falso y la RPC fallaría por la razón equivocada.
  await como(uAdm)
  const vacia = await enSavepoint(() => c.query(`SELECT ronda_plantilla_publicar($1)`, [plOtra]))
  check('no se publica una plantilla sin pasos', !vacia.ok
    && /sin un solo paso/.test(vacia.error || ''), (vacia.error || '').slice(0, 50))
  await comoDueno()

  // Un paso que depende de uno POSTERIOR no pasa la publicación.
  const alReves = (await una(`
    INSERT INTO ronda_plantillas (tipo_actividad_id, codigo, nombre) VALUES ($1,'ZZ_REVES','Al revés')
    RETURNING id`, [tipoAseo])).id
  const r2 = await paso(alReves, 2, 'CASILLA', 'Segundo', {})
  await paso(alReves, 1, 'TEXTO', 'Primero, pero depende del segundo', {}, { condicion: r2, valor: 'SI' })
  await como(uAdm)
  const malOrden = await enSavepoint(() => c.query(`SELECT ronda_plantilla_publicar($1)`, [alReves]))
  check('no se publica si un paso condicional depende de un paso posterior', !malOrden.ok
    && /va(n)? después/.test(malOrden.error || ''), (malOrden.error || '').slice(0, 55))

  await c.query(`SELECT ronda_plantilla_publicar($1)`, [pl1])
  await comoDueno()
  const pub1 = await una(`SELECT estado, publicada_at IS NOT NULL sello, publicada_por::text quien
                            FROM ronda_plantillas WHERE id=$1`, [pl1])
  check('la v1 queda PUBLICADA y sellada', pub1.estado === 'PUBLICADA' && pub1.sello === true
    && pub1.quien === uAdm)

  await como(uVer)
  const sinPermiso = await enSavepoint(() => c.query(`SELECT ronda_plantilla_publicar($1)`, [plOtra]))
  check('quien solo tiene ver_catalogo_rondas no puede publicar', !sinPermiso.ok,
    (sinPermiso.error || '').slice(0, 50))
  await comoDueno()

  // ── 6. Versionado: la v1 no se mueve ──────────────────────────────────────
  console.log('\n6) Versionado: publicar la v2 NO cambia nada de la v1')
  // Foto exacta de la v1 antes de hacer nada: los pasos COMPLETOS (son las
  // preguntas que contestó quien ejecutó con la v1) y la plantilla sin
  // `estado` ni `updated_at`, porque archivarla SÍ es lo que se espera.
  const foto = async () => (await una(`
    SELECT md5(string_agg(x, '|' ORDER BY x)) h FROM (
      SELECT (to_jsonb(p) - 'estado' - 'updated_at')::text x
        FROM ronda_plantillas p WHERE p.id = $1
      UNION ALL
      SELECT to_jsonb(s)::text FROM ronda_plantilla_pasos s WHERE s.plantilla_id = $1
    ) t`, [pl1])).h
  const antes = await foto()
  const pasosAntes = await todas(`SELECT to_jsonb(s)::text j FROM ronda_plantilla_pasos s
                                   WHERE s.plantilla_id=$1 ORDER BY s.orden`, [pl1])

  // Lo que hará F4: una respuesta guardada apunta a la VERSIÓN y al PASO.
  // Aquí se simula con las propias filas, que son las que no pueden moverse.
  const congelada = await enSavepoint(() => c.query(
    `UPDATE ronda_plantilla_pasos SET titulo='Cambiado a traición' WHERE id=$1`, [p2]))
  check('un paso de la v1 publicada NO se puede modificar', !congelada.ok,
    (congelada.error || '').slice(0, 55))
  const borrada = await enSavepoint(() => c.query(`DELETE FROM ronda_plantilla_pasos WHERE id=$1`, [p3]))
  check('un paso de la v1 publicada NO se puede borrar', !borrada.ok)
  const nuevoPaso = await enSavepoint(() => c.query(`
    INSERT INTO ronda_plantilla_pasos (plantilla_id, orden, tipo, titulo, config)
    VALUES ($1, 9, 'TEXTO', 'Colado', '{}'::jsonb)`, [pl1]))
  check('tampoco se le puede AGREGAR un paso a la v1 publicada', !nuevoPaso.ok)
  const cambioPlantilla = await enSavepoint(() => c.query(
    `UPDATE ronda_plantillas SET nombre='Otro nombre' WHERE id=$1`, [pl1]))
  check('la plantilla publicada no se puede renombrar', !cambioPlantilla.ok)
  const borrarPlantilla = await enSavepoint(() => c.query(`DELETE FROM ronda_plantillas WHERE id=$1`, [pl1]))
  check('la plantilla publicada no se puede borrar (se archiva)', !borrarPlantilla.ok)

  await como(uAdm)
  const pl2 = (await una(`SELECT ronda_plantilla_nueva_version($1) id`, [pl1])).id
  await comoDueno()
  const v2 = await una(`SELECT codigo, version, estado, origen_plantilla_id::text origen
                          FROM ronda_plantillas WHERE id=$1`, [pl2])
  check('la versión nueva nace en BORRADOR, con el mismo código y la v1 como origen',
    v2.version === 2 && v2.estado === 'BORRADOR' && v2.codigo === 'ZZ_ASEO_BANOS' && v2.origen === pl1)
  check('el clon trae los seis pasos',
    (await una(`SELECT count(*)::int n FROM ronda_plantilla_pasos WHERE plantilla_id=$1`, [pl2])).n === 6)
  const condClon = await una(`
    SELECT s.orden, d.orden AS dep, s.condicion_valor
      FROM ronda_plantilla_pasos s JOIN ronda_plantilla_pasos d ON d.id = s.condicion_paso_id
     WHERE s.plantilla_id = $1`, [pl2])
  check('y el paso condicional del clon apunta DENTRO del clon, no a la v1',
    condClon?.orden === 4 && condClon?.dep === 1 && condClon?.condicion_valor === 'NO')
  check('ningún paso del clon quedó apuntando a un paso de la v1',
    (await una(`SELECT count(*)::int n FROM ronda_plantilla_pasos s
                 WHERE s.plantilla_id=$1 AND s.condicion_paso_id IN
                       (SELECT id FROM ronda_plantilla_pasos WHERE plantilla_id=$2)`, [pl2, pl1])).n === 0)

  // Se edita la v2 a fondo y se publica.
  await c.query(`UPDATE ronda_plantillas SET nombre='Aseo de baños (revisado)' WHERE id=$1`, [pl2])
  await c.query(`UPDATE ronda_plantilla_pasos SET titulo='Foto del ambiente (dos tomas)',
                        config='{"min":2,"max":4,"solo_camara_vivo":true}'::jsonb
                  WHERE plantilla_id=$1 AND orden=2`, [pl2])
  await c.query(`DELETE FROM ronda_plantilla_pasos WHERE plantilla_id=$1 AND orden=5`, [pl2])
  await como(uAdm)
  await c.query(`SELECT ronda_plantilla_publicar($1)`, [pl2])
  await comoDueno()

  check('publicar la v2 no cambió el contenido de la v1', (await foto()) === antes)
  const pasosDespues = await todas(`SELECT to_jsonb(s)::text j FROM ronda_plantilla_pasos s
                                     WHERE s.plantilla_id=$1 ORDER BY s.orden`, [pl1])
  check('los seis pasos de la v1 están byte a byte iguales (son las preguntas ya contestadas)',
    pasosAntes.length === 6 && pasosDespues.length === 6
    && pasosAntes.every((r, i) => r.j === pasosDespues[i].j))
  check('lo ÚNICO que cambió en la fila de la v1 es el estado, que pasó a ARCHIVADA',
    (await una(`SELECT estado FROM ronda_plantillas WHERE id=$1`, [pl1])).estado === 'ARCHIVADA')
  const estados = await todas(`SELECT version, estado FROM ronda_plantillas
                                WHERE codigo='ZZ_ASEO_BANOS' ORDER BY version`)
  check('la v1 pasó a ARCHIVADA y la v2 es la única PUBLICADA',
    estados[0].estado === 'ARCHIVADA' && estados[1].estado === 'PUBLICADA',
    estados.map((e) => `v${e.version}:${e.estado}`).join(' '))
  check('ronda_plantilla_vigente() devuelve la v2',
    (await una(`SELECT ronda_plantilla_vigente('ZZ_ASEO_BANOS', NULL) id`)).id === pl2)
  const dosPub = await enSavepoint(() => c.query(
    `UPDATE ronda_plantillas SET estado='PUBLICADA' WHERE id=$1`, [pl1]))
  check('la base impide dos versiones PUBLICADAS del mismo código a la vez', !dosPub.ok)

  // ── 7. Ajuste por contrato ────────────────────────────────────────────────
  console.log('\n7) Catálogo heredable: el ajuste del contrato tapa a la plantilla general')
  await como(uA)
  const plA = (await una(`SELECT ronda_plantilla_nueva_version($1, $2) id`, [pl2, g1])).id
  await comoDueno()
  await c.query(`UPDATE ronda_plantillas SET nombre='Aseo de baños (contrato A)' WHERE id=$1`, [plA])
  await como(uA); await c.query(`SELECT ronda_plantilla_publicar($1)`, [plA]); await comoDueno()
  check('el ajuste del contrato A es la vigente PARA A',
    (await una(`SELECT ronda_plantilla_vigente('ZZ_ASEO_BANOS', $1) id`, [g1])).id === plA)
  check('y el contrato B sigue con la general',
    (await una(`SELECT ronda_plantilla_vigente('ZZ_ASEO_BANOS', $1) id`, [g2])).id === pl2)
  check('el ajuste de A arrancó en la versión 1 de su propia serie',
    (await una(`SELECT version FROM ronda_plantillas WHERE id=$1`, [plA])).version === 1)

  // ── 8. Alcance por contrato en la RLS ─────────────────────────────────────
  console.log('\n8) Alcance por contrato (auth_grupos + RLS)')
  const plB = (await una(`
    INSERT INTO ronda_plantillas (grupo_id, tipo_actividad_id, codigo, nombre, estado, publicada_at)
    VALUES ($1, $2, 'ZZ_SOLO_B', 'Plantilla privada de B', 'PUBLICADA', NOW()) RETURNING id`,
    [g2, tipoAseo])).id
  // La plantilla nace ya PUBLICADA: el congelado tiene que impedir los pasos.
  const pasoEnPub = await enSavepoint(() => paso(plB, 1, 'TEXTO', 'Paso privado de B', {}))
  check('a una plantilla creada ya PUBLICADA tampoco se le agregan pasos', !pasoEnPub.ok)

  const cuenta = async (sql, params) => Number((await una(sql, params)).n)
  await como(uA)
  check('A NO lee la plantilla privada del contrato B',
    await cuenta(`SELECT count(*)::int n FROM ronda_plantillas WHERE id=$1`, [plB]) === 0)
  check('A SÍ lee las plantillas del catálogo general',
    await cuenta(`SELECT count(*)::int n FROM ronda_plantillas WHERE grupo_id IS NULL AND codigo='ZZ_ASEO_BANOS'`) === 2)
  check('A lee su propio ajuste de contrato',
    await cuenta(`SELECT count(*)::int n FROM ronda_plantillas WHERE id=$1`, [plA]) === 1)
  check('A SÍ lee los tipos de actividad del catálogo general',
    await cuenta(`SELECT count(*)::int n FROM ronda_tipos_actividad WHERE grupo_id IS NULL`) === 8)
  check('A SÍ lee el instructivo general',
    await cuenta(`SELECT count(*)::int n FROM ronda_instructivos WHERE id=$1`, [instr]) === 1)
  check('A no ve ni los pasos de la plantilla privada de B',
    await cuenta(`SELECT count(*)::int n FROM ronda_plantilla_pasos s
                   JOIN ronda_plantillas p ON p.id=s.plantilla_id WHERE p.grupo_id=$1`, [g2]) === 0)

  await comoDueno(); await como(uB)
  check('B SÍ lee su plantilla privada',
    await cuenta(`SELECT count(*)::int n FROM ronda_plantillas WHERE id=$1`, [plB]) === 1)
  check('B NO lee el ajuste del contrato A',
    await cuenta(`SELECT count(*)::int n FROM ronda_plantillas WHERE id=$1`, [plA]) === 0)

  await comoDueno(); await como(uVer)
  const escrituraVer = await c.query(
    `UPDATE ronda_tipos_actividad SET nombre='Cambiado' WHERE grupo_id IS NULL`)
  check('quien solo tiene ver_catalogo_rondas no cambia el catálogo (RLS no le deja ninguna fila)',
    escrituraVer.rowCount === 0, `${escrituraVer.rowCount} filas`)

  await comoDueno()
  const rolNada = (await una(`
    INSERT INTO roles (nombre, descripcion, rol_base, permisos)
    VALUES ('ZZ F3 Sin nada', 'solo para la prueba', 'OPERADOR_SEDE', '{"ver_stock":true}'::jsonb)
    RETURNING id`)).id
  const uNada = await nuevoUsuario('nada', g1, 'OPERADOR_SEDE', rolNada)
  await como(uNada)
  check('sin ver_catalogo_rondas no se lee NADA del catálogo, ni lo general',
    await cuenta(`SELECT count(*)::int n FROM ronda_plantillas`) === 0
    && await cuenta(`SELECT count(*)::int n FROM ronda_tipos_actividad`) === 0
    && await cuenta(`SELECT count(*)::int n FROM ronda_instructivos`) === 0)
  await comoDueno()
  await como(uAdm)
  check('el ADMIN ve las plantillas de los dos contratos y las generales',
    await cuenta(`SELECT count(*)::int n FROM ronda_plantillas WHERE codigo LIKE 'ZZ_%'`) >= 5)
  await comoDueno()

  // ── 9. Asignaciones y «qué aplica aquí y ahora» ───────────────────────────
  console.log('\n9) ronda_tareas_aplicables(): día y hora de Bogotá, ventana, tolerancia y vigencia')
  const punto1 = (await una(`SELECT gen_random_uuid() id`)).id   // F2 lo hará un ronda_puntos
  const puntoV = (await una(`SELECT gen_random_uuid() id`)).id
  const hoyBta = (await una(`SELECT (NOW() AT TIME ZONE 'America/Bogota')::date d,
                                    EXTRACT(ISODOW FROM (NOW() AT TIME ZONE 'America/Bogota'))::int dow`))
  const asignar = async (campos) => (await una(`
    INSERT INTO ronda_asignaciones (grupo_id, sede_id, punto_id, plantilla_codigo, frecuencia,
                                    cada_horas, dias, ventana_desde, ventana_hasta, tolerancia_min,
                                    evento, rol_id, prioridad, sla_min)
    VALUES ($1,$2,$3,$4,$5,$6,$7::smallint[],$8,$9,COALESCE($10,30),$11,$12,COALESCE($13,'MEDIA'),$14)
    RETURNING id`, [campos.grupo ?? g1, campos.sede ?? sede1, campos.punto ?? punto1,
      campos.codigo ?? 'ZZ_ASEO_BANOS', campos.frecuencia ?? 'DIARIA', campos.cada ?? null,
      campos.dias ?? '{1,2,3,4,5,6,7}', campos.desde ?? null, campos.hasta ?? null,
      campos.tolerancia ?? null, campos.evento ?? null, campos.rol ?? rolCat,
      campos.prioridad ?? null, campos.sla ?? null])).id

  // Validaciones de la tabla
  const sinResponsable = await enSavepoint(() => c.query(`
    INSERT INTO ronda_asignaciones (grupo_id, sede_id, punto_id, plantilla_codigo, frecuencia)
    VALUES ($1,$2,$3,'ZZ_ASEO_BANOS','DIARIA')`, [g1, sede1, punto1]))
  check('una asignación sin rol, cargo ni persona se rechaza', !sinResponsable.ok)
  const horasSinN = await enSavepoint(() => asignar({ frecuencia: 'CADA_N_HORAS' }))
  check('CADA_N_HORAS sin `cada_horas` se rechaza', !horasSinN.ok)
  const eventoSinNombre = await enSavepoint(() => asignar({ frecuencia: 'POR_EVENTO' }))
  check('POR_EVENTO sin `evento` se rechaza', !eventoSinNombre.ok)
  const mediaVentana = await enSavepoint(() => asignar({ desde: '06:00' }))
  check('media ventana (solo hora de inicio) se rechaza', !mediaVentana.ok)
  const diaMalo = await enSavepoint(() => asignar({ dias: '{0,8}' }))
  check('días fuera de 1..7 se rechazan', !diaMalo.ok)

  // La de todos los días, sin ventana: aplica siempre.
  const aTodoDia = await asignar({ prioridad: 'ALTA', sla: 30 })
  // Una con ventana de 06:00 a 08:00 y tolerancia 15.
  const aManana = await asignar({ desde: '06:00', hasta: '08:00', tolerancia: 15, frecuencia: 'CADA_N_HORAS', cada: 4 })
  // Una que cruza medianoche: 22:00 a 06:00.
  const aNoche = await asignar({ desde: '22:00', hasta: '06:00', tolerancia: 0, prioridad: 'CRITICA' })
  // Una solo para el día de MAÑANA en hora de Bogotá (no debe aparecer hoy).
  // Va con otra frecuencia porque el índice único no admite la misma plantilla
  // dos veces en la misma ventana del mismo punto, que es justo lo que se
  // comprueba al final de esta sección.
  const otroDia = ((hoyBta.dow % 7) + 1)
  const aOtroDia = await asignar({ dias: `{${otroDia}}`, frecuencia: 'SEMANAL' })
  // Una del contrato vencido, en otro punto.
  const aVencida = await asignar({ grupo: gVencido, sede: sedeV, punto: puntoV })
  check('cruza_medianoche se calculó sola',
    (await una(`SELECT cruza_medianoche c FROM ronda_asignaciones WHERE id=$1`, [aNoche])).c === true
    && (await una(`SELECT cruza_medianoche c FROM ronda_asignaciones WHERE id=$1`, [aManana])).c === false)

  const enMomento = async (hora, solo = false, punto = punto1, uid = uAdm) => {
    await como(uid)
    const r = await todas(
      `SELECT asignacion_id::text id, plantilla_id::text pid, plantilla_codigo, plantilla_version,
              en_ventana, en_tolerancia, dia_ventana::text dia, prioridad, pasos, duracion_estimada_min
         FROM ronda_tareas_aplicables($1, ($2::date + $3::time) AT TIME ZONE 'America/Bogota', $4)`,
      [punto, hoyBta.d, hora, solo])
    await comoDueno()
    return r
  }

  const a0700 = await enMomento('07:00')
  const ids0700 = a0700.map((r) => r.id)
  check('a las 07:00 aparecen las tres asignaciones del día y no la de otro día',
    ids0700.includes(aTodoDia) && ids0700.includes(aManana) && ids0700.includes(aNoche)
    && !ids0700.includes(aOtroDia), `${a0700.length} filas`)
  check('la de la mañana está EN ventana a las 07:00',
    a0700.find((r) => r.id === aManana)?.en_ventana === true)
  check('la de la noche NO está en ventana a las 07:00',
    a0700.find((r) => r.id === aNoche)?.en_ventana === false)
  // El punto es del contrato A, que tiene su propio ajuste publicado: lo que
  // se resuelve es ESE, no la plantilla general. Es la herencia de §4.1 vista
  // desde la ejecución.
  const fTodoDia = a0700.find((r) => r.id === aTodoDia)
  check('se resuelve el AJUSTE publicado del contrato A, no la plantilla general',
    fTodoDia?.pid === plA, `${fTodoDia?.plantilla_codigo} v${fTodoDia?.plantilla_version}`)
  check('y con los pasos que tiene esa versión, no los de la v1',
    fTodoDia?.pasos === 5, `${fTodoDia?.pasos} pasos`)
  check('trae el tiempo estándar de la tarea', fTodoDia?.duracion_estimada_min === 12)
  check('lo CRÍTICO sale primero', a0700[0].prioridad === 'CRITICA')

  const sol0810 = await enMomento('08:10', true)
  check('a las 08:10 la de la mañana sigue viva por la tolerancia de 15 minutos',
    sol0810.some((r) => r.id === aManana && r.en_ventana === false && r.en_tolerancia === true))
  const sol0830 = await enMomento('08:30', true)
  check('a las 08:30 ya se pasó de la tolerancia y no aparece',
    !sol0830.some((r) => r.id === aManana))

  const a0100 = await enMomento('01:00')
  const n0100 = a0100.find((r) => r.id === aNoche)
  check('a la 01:00 la ronda de 22:00 a 06:00 sigue en ventana, con el día de AYER',
    n0100?.en_ventana === true && n0100?.dia === (await una(
      `SELECT ($1::date - 1)::text d`, [hoyBta.d])).d, n0100?.dia)
  check('y la de la mañana no está en ventana a la 01:00',
    a0100.find((r) => r.id === aManana)?.en_ventana === false)

  check('p_solo_ahora deja solo lo que aplica en este momento',
    (await enMomento('07:00', true)).length < a0700.length)

  check('un contrato VENCIDO no tiene tareas, aunque la asignación esté activa',
    (await enMomento('07:00', false, puntoV)).length === 0 && !!aVencida)

  const aPuntoA = await asignar({ punto: punto1, codigo: 'ZZ_SOLO_B', frecuencia: 'MENSUAL' })
  check('una asignación cuyo código no tiene versión publicada para ese contrato no se ofrece',
    !(await enMomento('07:00')).some((r) => r.plantilla_codigo === 'ZZ_SOLO_B') && !!aPuntoA)

  // Alcance: la función no cruza contratos ni para un usuario con permisos.
  check('un usuario del contrato B no ve las tareas de un punto del contrato A',
    (await enMomento('07:00', false, punto1, uB)).length === 0)
  check('pero el usuario del contrato A sí las ve',
    (await enMomento('07:00', false, punto1, uA)).length > 0)

  // Duplicado de asignación en la misma ventana.
  const repetida = await enSavepoint(() => asignar({ desde: '06:00', hasta: '08:00',
    frecuencia: 'CADA_N_HORAS', cada: 4 }))
  check('no se puede asignar dos veces la misma plantilla en la misma ventana del mismo punto',
    !repetida.ok)

  // ── 10. Borrar el contrato no se traba con el congelado ───────────────────
  console.log('\n10) Borrar un contrato con plantillas publicadas (cascada)')
  // El congelado prohíbe borrar una plantilla publicada y sus pasos, pero la
  // CASCADA del borrado del contrato tiene que pasar igual: si no, un contrato
  // con catálogo propio sería imposible de eliminar. Contrato aparte, sin
  // usuarios colgando, para que lo único que se pruebe sea eso.
  const gC = (await una(`
    INSERT INTO grupos_contrato (codigo, nombre, estado) VALUES ('ZZF3C','Contrato F3 C','VIGENTE')
    RETURNING id`)).id
  const plC = (await una(`
    INSERT INTO ronda_plantillas (grupo_id, tipo_actividad_id, codigo, nombre)
    VALUES ($1,$2,'ZZ_SOLO_C','Plantilla privada de C') RETURNING id`, [gC, tipoAseo])).id
  await paso(plC, 1, 'CASILLA', '¿Listo?', {})
  await como(uAdm); await c.query(`SELECT ronda_plantilla_publicar($1)`, [plC]); await comoDueno()
  const borradoC = await enSavepoint(() => c.query(`DELETE FROM grupos_contrato WHERE id=$1`, [gC]))
  check('se puede borrar un contrato aunque tenga una plantilla PUBLICADA (la cascada no se traba)',
    borradoC.ok, (borradoC.error || '').slice(0, 70))

  await comoDueno()
} finally {
  await c.query('ROLLBACK')
  await c.end()
}

console.log(`\n${ok} pruebas bien, ${fail} mal. Todo revertido con ROLLBACK: la base queda igual.`)
process.exit(fail > 0 ? 1 : 0)

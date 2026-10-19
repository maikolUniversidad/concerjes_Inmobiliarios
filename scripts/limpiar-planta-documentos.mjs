// =============================================================================
// Tanda 1 · documentos que son un número de celular
// =============================================================================
// `vw_planta_inconsistencias` marca con DOCUMENTO_SOSPECHOSO las fichas cuyo
// `documento` cumple '^3[0-9]{9}$'. Son 74 y todas tienen el mismo origen: el
// cargue de sedes del 2026-08-11 creó una ficha por cada RESPONSABLE DE SEDE
// con el celular metido en el campo del documento.
//
// LO QUE NO ESTÁ EN RIESGO (verificado en la base antes de escribir esto):
//   · ninguna de las 74 tiene cuenta de auth → las 859 cuentas
//     «<cédula>@conserje.local» no se tocan. Además `crear-usuarios-empleados`
//     exige vinculación ACTIVA y estas fichas no tienen ninguna, así que un
//     documento de relleno tampoco les va a inventar un login después.
//   · ninguna tiene vinculaciones → no hay `clave_origen` que romper, y
//     reimportar la nómina no las pisa (el cargue entra por documento y estos
//     documentos no están en los informes).
//   · ninguna tiene candidato del ATS ni documentos_persona.
// LO QUE SÍ ESTÁ EN RIESGO:
//   · `sedes.responsable_id` apunta a las 74 y NO tiene llave foránea: si se
//     borra la ficha sin reapuntar la sede, queda un responsable fantasma.
//     Por eso la fusión reapunta la sede ANTES de borrar.
//
// Dos cosas distintas que se pueden hacer, cada una con su bandera:
//
//   --fusionar          Las 11 fichas que son la MISMA persona que una ficha de
//                       nómina (mismo nombre y apellido, y exactamente una
//                       coincidencia). Reapunta la sede a la ficha de nómina,
//                       le pasa el teléfono y borra la ficha manual. Por
//                       defecto solo las de evidencia FUERTE: aquellas en que
//                       el teléfono de la ficha de nómina es exactamente ese
//                       celular. Con --fusionar-dudosos entran también las que
//                       solo coinciden por nombre.
//   --marcar            El resto: no sabemos la cédula, así que se deja de
//                       afirmar que el celular lo es. `documento` pasa a
//                       'SIN-CC-<el mismo celular>' y el celular se queda en
//                       `telefono`, donde siempre debió estar. NO es arreglar
//                       la cédula: es dejar escrito que falta. Se usa el propio
//                       número como sufijo —y no el código de la sede, que no
//                       es único: las 74 sedes comparten CMM-2026-000029—
//                       porque así el relleno es único, se ve a simple vista
//                       que falta la cédula y el valor viejo es recuperable.
//
// Sin banderas solo informa. Nada se escribe sin --aplicar.
//
// Uso:
//   node --use-system-ca scripts/limpiar-planta-documentos.mjs
//   node --use-system-ca scripts/limpiar-planta-documentos.mjs --fusionar
//   node --use-system-ca scripts/limpiar-planta-documentos.mjs --fusionar --aplicar
//   node --use-system-ca scripts/limpiar-planta-documentos.mjs --marcar --aplicar
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
const FUSIONAR = args.includes('--fusionar')
const FUSIONAR_DUDOSOS = args.includes('--fusionar-dudosos')
const MARCAR = args.includes('--marcar')
const MUESTRA = flag('muestra', null)
const PREFIJO = flag('prefijo', 'SIN-CC-')

const env = readFileSync(join(root, '.env.local'), 'utf8')
const c = new Client({
  connectionString: env.match(/^DIRECT_URL="?([^"\n]+)"?/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
})
await c.connect()

// ── Qué hay ──────────────────────────────────────────────────────────────────
const CELULAR = `'^3[0-9]{9}$'`

const marcadas = (await c.query(`
  SELECT p.id, p.documento, p.tipo_doc, p.nombres, p.apellidos, p.cargo, p.origen, p.estado,
         p.telefono, p.sede_id, p.usuario_id, p.created_at,
         s.codigo_interno AS sede_codigo, s.nombre AS sede_nombre, s.ciudad AS sede_ciudad,
         (s.responsable_id = p.id) AS es_responsable,
         (SELECT COUNT(*) FROM persona_vinculaciones v WHERE v.persona_id = p.id)::int AS vinculaciones,
         (SELECT COUNT(*) FROM candidatos ca WHERE ca.persona_id = p.id)::int AS candidatos,
         (SELECT COUNT(*) FROM documentos_persona d WHERE d.persona_id = p.id)::int AS documentos
    FROM personas p
    LEFT JOIN sedes s ON s.id = p.sede_id
   WHERE p.documento ~ ${CELULAR}
   ORDER BY s.codigo_interno
`)).rows

// Gemelos: misma persona ya cargada desde nómina. Se exige UNA sola
// coincidencia; con dos o más no se sabe cuál es y no se toca.
const gemelos = (await c.query(`
  WITH sosp AS (SELECT id, nombres, apellidos, documento, sede_id FROM personas WHERE documento ~ ${CELULAR})
  SELECT s.id AS manual_id, s.documento AS celular, s.sede_id,
         p.id AS nomina_id, p.documento AS cedula, p.telefono AS tel_nomina,
         p.estado, p.origen, (p.usuario_id IS NOT NULL) AS tiene_cuenta,
         (SELECT COUNT(*) FROM persona_vinculaciones v WHERE v.persona_id = p.id)::int AS vinculaciones,
         p.sede_id AS nomina_sede_id,
         (SELECT COUNT(*) FROM personas q
           WHERE q.id <> s.id
             AND upper(coalesce(q.nombres,'')) = upper(coalesce(s.nombres,''))
             AND upper(coalesce(q.apellidos,'')) = upper(coalesce(s.apellidos,'')))::int AS coincidencias
    FROM sosp s
    JOIN personas p ON p.id <> s.id
     AND upper(coalesce(p.nombres,'')) = upper(coalesce(s.nombres,''))
     AND upper(coalesce(p.apellidos,'')) = upper(coalesce(s.apellidos,''))
`)).rows

const unicos = gemelos.filter((g) => g.coincidencias === 1)
const fuertes = unicos.filter((g) => g.tel_nomina === g.celular)
const sinTel = unicos.filter((g) => g.tel_nomina === null)
const otroTel = unicos.filter((g) => g.tel_nomina !== null && g.tel_nomina !== g.celular)
const ambiguos = gemelos.filter((g) => g.coincidencias > 1)

const aFusionar = FUSIONAR_DUDOSOS ? [...fuertes, ...sinTel, ...otroTel] : fuertes
const idsFusion = new Set(aFusionar.map((g) => g.manual_id))
const aMarcar = marcadas.filter((m) => !idsFusion.has(m.id))

// ── Informe ──────────────────────────────────────────────────────────────────
const modo = APLICAR ? 'APLICANDO' : 'SIMULACIÓN'
console.log(`\nTanda 1 · documentos que son un celular  (${modo})\n`)
console.log(`fichas marcadas DOCUMENTO_SOSPECHOSO : ${marcadas.length}`)

const perfil = {
  'origen MANUAL': marcadas.filter((m) => m.origen === 'MANUAL').length,
  'cargo RESPONSABLE DE SEDE': marcadas.filter((m) => m.cargo === 'RESPONSABLE DE SEDE').length,
  'telefono = documento': marcadas.filter((m) => m.telefono === m.documento).length,
  'responsable de su sede': marcadas.filter((m) => m.es_responsable).length,
  'con cuenta de auth': marcadas.filter((m) => m.usuario_id).length,
  'con vinculaciones': marcadas.filter((m) => m.vinculaciones > 0).length,
  'con candidato del ATS': marcadas.filter((m) => m.candidatos > 0).length,
  'con documentos adjuntos': marcadas.filter((m) => m.documentos > 0).length,
}
console.log('\nel patrón:')
for (const [k, v] of Object.entries(perfil)) console.log(`  ${String(v).padStart(4)} / ${marcadas.length}  ${k}`)

console.log('\nmisma persona que una ficha de nómina:')
console.log(`  ${String(fuertes.length).padStart(4)}  evidencia FUERTE  · mismo nombre y la ficha de nómina tiene ese mismo celular`)
console.log(`  ${String(sinTel.length).padStart(4)}  evidencia MEDIA   · mismo nombre y la ficha de nómina no tiene teléfono`)
console.log(`  ${String(otroTel.length).padStart(4)}  evidencia DÉBIL   · mismo nombre pero otro teléfono en nómina (puede ser un tocayo)`)
console.log(`  ${String(ambiguos.length).padStart(4)}  ambiguas          · el nombre coincide con más de una ficha: no se toca`)
console.log(`  ${String(marcadas.length - unicos.length - ambiguos.length).padStart(4)}  sin gemelo        · no hay ficha de nómina con ese nombre`)

if (FUSIONAR) {
  console.log(`\n--fusionar: ${aFusionar.length} fichas${FUSIONAR_DUDOSOS ? ' (incluyendo las dudosas)' : ' (solo evidencia FUERTE)'}`)
  console.log('  por cada una: la sede pasa a apuntar a la ficha de nómina, esa ficha')
  console.log('  recibe la sede y el teléfono, y la ficha manual se BORRA.')
  for (const g of aFusionar) {
    const m = marcadas.find((x) => x.id === g.manual_id)
    console.log(`    sede ${m?.sede_codigo ?? '?'}: doc ${g.celular} (manual) → doc ${g.cedula.slice(0, 2)}****${g.cedula.slice(-2)} (nómina, ${g.vinculaciones} vinculación/es${g.tiene_cuenta ? ', con cuenta' : ''})`)
  }
}

if (MARCAR) {
  console.log(`\n--marcar: ${aMarcar.length} fichas`)
  const choques = new Map()
  for (const m of aMarcar) {
    const nuevo = PREFIJO + m.documento
    choques.set(nuevo, (choques.get(nuevo) || 0) + 1)
  }
  const repetidos = [...choques.entries()].filter(([, n]) => n > 1)
  console.log('  antes y después (una muestra):')
  for (const m of aMarcar.slice(0, 8)) {
    console.log(`    ${m.documento} → ${PREFIJO}${m.documento}   (telefono se queda en ${m.telefono})`)
  }
  if (repetidos.length) {
    console.log(`  ¡OJO! ${repetidos.length} documento(s) de relleno quedarían repetidos; el documento es único.`)
    console.log('  Esas fichas se dejan como están.')
  }
}

if (MUESTRA) {
  writeFileSync(MUESTRA, JSON.stringify({
    generado: new Date().toISOString(),
    resumen: { marcadas: marcadas.length, fuertes: fuertes.length, media: sinTel.length, debil: otroTel.length, ambiguas: ambiguos.length },
    fusion: aFusionar.map((g) => ({
      sede: marcadas.find((x) => x.id === g.manual_id)?.sede_codigo,
      celular_en_documento: g.celular,
      ficha_nomina: { estado: g.estado, vinculaciones: g.vinculaciones, tiene_cuenta: g.tiene_cuenta, telefono: g.tel_nomina },
    })),
    marcar: aMarcar.map((m) => ({
      sede: m.sede_codigo, sede_ciudad: m.sede_ciudad,
      antes: m.documento, despues: PREFIJO + m.documento, telefono: m.telefono,
    })),
  }, null, 2), 'utf8')
  console.log(`\nmuestra para revisar: ${MUESTRA}`)
}

if (!APLICAR || (!FUSIONAR && !MARCAR)) {
  console.log(`\n${!APLICAR ? 'Simulación: no se escribió nada.' : 'Sin --fusionar ni --marcar no hay nada que aplicar.'}`)
  console.log('Para aplicar: --fusionar --aplicar  /  --marcar --aplicar\n')
  await c.end()
  process.exit(0)
}

// ── Aplicación ───────────────────────────────────────────────────────────────
await c.query('BEGIN')
let fusionadas = 0, marcadasOk = 0, saltadas = 0

if (FUSIONAR) {
  for (const g of aFusionar) {
    // Re-verificación dentro de la transacción: si la ficha manual ganó
    // historial desde la simulación, se salta.
    const dep = (await c.query(`
      SELECT (SELECT COUNT(*) FROM persona_vinculaciones WHERE persona_id = $1)::int v,
             (SELECT COUNT(*) FROM candidatos WHERE persona_id = $1)::int ca,
             (SELECT COUNT(*) FROM documentos_persona WHERE persona_id = $1)::int d,
             (SELECT usuario_id FROM personas WHERE id = $1) u
    `, [g.manual_id])).rows[0]
    if (dep.v > 0 || dep.ca > 0 || dep.d > 0 || dep.u) { saltadas++; continue }

    await c.query(`UPDATE sedes SET responsable_id = $2 WHERE responsable_id = $1`, [g.manual_id, g.nomina_id])
    await c.query(
      `UPDATE personas SET sede_id = COALESCE(sede_id, $2), telefono = COALESCE(telefono, $3) WHERE id = $1`,
      [g.nomina_id, g.sede_id, g.celular]
    )
    const del = await c.query(`DELETE FROM personas WHERE id = $1 AND documento = $2`, [g.manual_id, g.celular])
    fusionadas += del.rowCount
  }
}

if (MARCAR) {
  for (const m of aMarcar) {
    if (idsFusion.has(m.id)) continue
    const nuevo = PREFIJO + m.documento
    const choca = (await c.query(`SELECT 1 FROM personas WHERE documento = $1 AND id <> $2`, [nuevo, m.id])).rowCount
    if (choca) { saltadas++; continue }
    const res = await c.query(
      `UPDATE personas SET documento = $2, telefono = COALESCE(telefono, $3) WHERE id = $1 AND documento = $3`,
      [m.id, nuevo, m.documento]
    )
    marcadasOk += res.rowCount
  }
}

await c.query('COMMIT')
const quedan = (await c.query(
  `SELECT COUNT(*)::int n FROM vw_planta_inconsistencias WHERE motivo = 'DOCUMENTO_SOSPECHOSO'`
)).rows[0].n
const huerfanas = (await c.query(
  `SELECT COUNT(*)::int n FROM sedes s WHERE s.responsable_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM personas p WHERE p.id = s.responsable_id)`
)).rows[0].n
console.log(`\nfusionadas (ficha manual borrada): ${fusionadas}`)
console.log(`marcadas como «sin cédula»        : ${marcadasOk}`)
console.log(`saltadas por seguridad            : ${saltadas}`)
console.log(`DOCUMENTO_SOSPECHOSO en la vista  : ${marcadas.length} → ${quedan}`)
console.log(`sedes con responsable fantasma    : ${huerfanas}\n`)
await c.end()

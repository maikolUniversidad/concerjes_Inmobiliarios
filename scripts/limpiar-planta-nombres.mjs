// =============================================================================
// Tanda 2 · el corte apellidos/nombres dudoso de la planta
// =============================================================================
// `vw_planta_inconsistencias` marca con NOMBRE_DUDOSO las fichas de nómina cuyo
// corte automático entre apellidos y nombres quedó en MEDIA o BAJA. El cargue
// (scripts/importar-planta-personal.mjs) decide ese corte con un puntaje de
// frecuencia suavizado: una palabra vista UNA sola vez ya se iba para un lado,
// y de ahí salió la zona gris.
//
// Este guion vuelve a decidir, pero EXIGIENDO EVIDENCIA, y solo acepta tres
// clases de evidencia. Del propio maestro de nómina se sabe, sin discusión, que
// la PRIMERA palabra de «Apellidos y Nombres» es siempre un apellido y la
// ÚLTIMA es siempre un nombre de pila. De ahí:
//
//   1. CONVENCIÓN DE LA COLUMNA — con solo dos palabras no hay nada que
//      decidir: la primera es el apellido y la segunda el nombre. Son 102
//      fichas que quedaron en BAJA por cortas, no por dudosas.
//   2. EVIDENCIA DE LA PALABRA — se cuenta en cuántas fichas cada palabra
//      aparece de primera (apellido seguro) y en cuántas de última (nombre
//      seguro). Solo se usa si tiene al menos --min-obs apariciones y el
//      reparto es contundente (>= --umbral de un lado).
//   3. PAR DE APELLIDOS COMPARTIDO — si las dos primeras palabras aparecen
//      juntas, y en ese mismo orden, al principio de las fichas de dos o más
//      personas distintas, es un par de apellidos de familia: dos apellidos.
//
// Lo que no cae en una de las tres SE QUEDA MARCADO. No se adivina y no se
// aplica «la convención colombiana de dos apellidos» como relleno: justamente
// eso es lo que ya está guardado en las 248 fichas largas, y lo que la vista
// está pidiendo que alguien confirme con un documento en la mano.
//
// Nunca se toca `nombre_completo`: es la fuente de verdad. Solo se reparten
// `apellidos` / `nombres` y se sube `nombre_confianza` a ALTA en lo resuelto.
//
// Uso:
//   node --use-system-ca scripts/limpiar-planta-nombres.mjs                 (simulación)
//   node --use-system-ca scripts/limpiar-planta-nombres.mjs --aplicar
//   node --use-system-ca scripts/limpiar-planta-nombres.mjs --muestra C:/tmp/nombres.json
//   node --use-system-ca scripts/limpiar-planta-nombres.mjs --min-obs 10 --umbral 0.85
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
const MIN_OBS = Number(flag('min-obs', 10))
const UMBRAL = Number(flag('umbral', 0.9))
const MUESTRA = flag('muestra', null)
const CUANTAS = Number(flag('casos', 30))

// ── Unidades de un nombre (las partículas se pegan a la palabra que sigue) ────
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'VAN', 'VON', 'DA', 'DI', 'DO', 'DOS'])
const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

function unidades(nombreCompleto) {
  const t = String(nombreCompleto ?? '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  const out = []
  let buffer = []
  for (const p of t) {
    if (PARTICULAS.has(sinTildes(p))) { buffer.push(p); continue }
    out.push([...buffer, p].join(' '))
    buffer = []
  }
  if (buffer.length) out.push(buffer.join(' '))
  return out
}

// ── Evidencia: cuántas veces cada palabra es primera (apellido) o última (nombre)
function contarEvidencia(fichas) {
  const prim = new Map(), ult = new Map(), pares = new Map()
  const sube = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  for (const f of fichas) {
    const u = unidades(f.nombre_completo)
    if (u.length < 2) continue
    sube(prim, sinTildes(u[0]))
    sube(ult, sinTildes(u[u.length - 1]))
    // Par de apellidos candidato: las dos primeras palabras de una ficha larga.
    // Se cuentan PERSONAS distintas, no filas.
    if (u.length >= 3) {
      const k = sinTildes(u[0]) + ' ' + sinTildes(u[1])
      if (!pares.has(k)) pares.set(k, new Set())
      pares.get(k).add(f.documento)
    }
  }
  // 'NOMBRE' | 'APELLIDO' | 'INCIERTO' — sin suavizado: o hay observaciones o no.
  const clasificar = (unidad) => {
    const k = sinTildes(unidad || '')
    const p = prim.get(k) || 0
    const l = ult.get(k) || 0
    const obs = p + l
    if (obs < MIN_OBS) return { clase: 'INCIERTO', p, l, obs, razon: `solo ${obs} apariciones` }
    const r = l / obs
    if (r >= UMBRAL) return { clase: 'NOMBRE', p, l, obs, razon: `${l} de ${obs} veces va de última` }
    if (r <= 1 - UMBRAL) return { clase: 'APELLIDO', p, l, obs, razon: `${p} de ${obs} veces va de primera` }
    return { clase: 'INCIERTO', p, l, obs, razon: `reparto ${p}/${l}, no es contundente` }
  }
  // Cuántas personas distintas empiezan su nombre con este par de palabras.
  const personasConElPar = (a, b) => (pares.get(sinTildes(a) + ' ' + sinTildes(b)) || new Set()).size
  return { clasificar, personasConElPar }
}

// ── La regla ─────────────────────────────────────────────────────────────────
// Devuelve el número de apellidos (1 o 2), -1 si el nombre viene invertido, o
// null cuando no hay con qué decidir; más la regla que lo resolvió.
const MIN_PERSONAS_PAR = 2

function decidirCorte(u, ev) {
  if (u.length < 2) return { corte: null, regla: null, motivo: 'una sola palabra' }
  const c0 = ev.clasificar(u[0])
  const c1 = ev.clasificar(u[1])

  // 1 · Convención de la columna: dos palabras = un apellido y un nombre.
  if (u.length === 2) {
    if (c0.clase === 'NOMBRE' && c1.clase === 'APELLIDO') {
      return { corte: -1, regla: 'INVERTIDO', motivo: `viene al revés: «${u[0]}» es nombre (${c0.razon}) y «${u[1]}» apellido (${c1.razon})` }
    }
    return { corte: 1, regla: 'COLUMNA', motivo: 'dos palabras: la 1ª es el apellido y la 2ª el nombre, por la columna «Apellidos y Nombres»' }
  }

  // 2 · Evidencia de la palabra.
  if (c1.clase === 'NOMBRE') {
    return { corte: 1, regla: 'PALABRA', motivo: `«${u[1]}» es nombre de pila (${c1.razon}) → un solo apellido` }
  }
  if (c1.clase === 'APELLIDO') {
    // Con 4+ palabras un tercer apellido seguido también es posible; si la
    // tercera palabra TAMBIÉN se comporta como apellido, no se decide.
    const c2 = ev.clasificar(u[2])
    if (u.length > 3 && c2.clase === 'APELLIDO') {
      return { corte: null, regla: null, motivo: `«${u[1]}» y «${u[2]}» se comportan las dos como apellido` }
    }
    return { corte: 2, regla: 'PALABRA', motivo: `«${u[1]}» es apellido (${c1.razon}) → dos apellidos` }
  }

  // 3 · Par de apellidos compartido con otra familia de la nómina.
  const personas = ev.personasConElPar(u[0], u[1])
  if (personas >= MIN_PERSONAS_PAR) {
    return { corte: 2, regla: 'PAR', motivo: `«${u[0]} ${u[1]}» encabeza la ficha de ${personas} personas distintas: es un par de apellidos` }
  }

  return { corte: null, regla: null, motivo: `«${u[1]}»: ${c1.razon}` }
}

// ── Conexión igual que el resto de los guiones del repo ──────────────────────
const env = readFileSync(join(root, '.env.local'), 'utf8')
const c = new Client({
  connectionString: env.match(/^DIRECT_URL="?([^"\n]+)"?/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
})
await c.connect()

const corpus = (await c.query(
  `SELECT documento, nombre_completo FROM personas
    WHERE origen = 'IMPORTACION_NOMINA' AND nombre_completo IS NOT NULL`
)).rows
const ev = contarEvidencia(corpus)

const dudosos = (await c.query(
  `SELECT p.id, p.documento, p.nombre_completo, p.apellidos, p.nombres, p.nombre_confianza
     FROM vw_planta_inconsistencias i
     JOIN personas p ON p.id = i.id
    WHERE i.motivo = 'NOMBRE_DUDOSO'
    ORDER BY p.nombre_completo`
)).rows

const resueltos = [], sinResolver = []
for (const p of dudosos) {
  const u = unidades(p.nombre_completo)
  const d = decidirCorte(u, ev)
  if (d.corte === null) { sinResolver.push({ ...p, motivo: d.motivo }); continue }
  const apellidos = d.corte === -1 ? u[1] : u.slice(0, d.corte).join(' ')
  const nombres = d.corte === -1 ? u[0] : u.slice(d.corte).join(' ')
  resueltos.push({
    id: p.id, documento: p.documento, nombre_completo: p.nombre_completo,
    antes_apellidos: p.apellidos, antes_nombres: p.nombres, confianza_antes: p.nombre_confianza,
    apellidos, nombres,
    cambia: apellidos !== p.apellidos || nombres !== p.nombres,
    invertido: d.corte === -1,
    regla: d.regla,
    motivo: d.motivo,
  })
}

// ── Informe ──────────────────────────────────────────────────────────────────
const cambian = resueltos.filter((r) => r.cambia)
console.log(`\nTanda 2 · corte apellidos/nombres  ${APLICAR ? '(APLICANDO)' : '(SIMULACIÓN)'}`)
console.log(`corpus de evidencia: ${corpus.length} nombres de nómina`)
console.log(`umbral: >= ${MIN_OBS} apariciones y >= ${(UMBRAL * 100).toFixed(0)} % de un lado\n`)
console.log(`fichas marcadas NOMBRE_DUDOSO : ${dudosos.length}`)
console.log(`  la regla resuelve           : ${resueltos.length}`)
console.log(`    · corrige el corte        : ${cambian.length}`)
console.log(`    · confirma el que ya hay  : ${resueltos.length - cambian.length}`)
console.log(`  se quedan marcadas          : ${sinResolver.length}`)

const ETIQUETA = {
  COLUMNA: '1 · convención de la columna (dos palabras)',
  PALABRA: '2 · evidencia de la palabra',
  PAR: '3 · par de apellidos compartido',
  INVERTIDO: '— nombre invertido, hay que revisarlo a mano',
}
const porRegla = {}
for (const r of resueltos) porRegla[r.regla] = (porRegla[r.regla] || 0) + 1
console.log('\nqué regla resolvió cada una:')
for (const [k, v] of Object.entries(porRegla).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(4)}  ${ETIQUETA[k] || k}`)
}

const porMotivo = {}
for (const s of sinResolver) {
  const k = s.motivo.includes('sin evidencia para las dos') ? 'dos palabras, sin evidencia para las dos'
    : s.motivo.includes('no es contundente') ? 'la palabra se usa de los dos lados'
    : s.motivo.includes('apariciones') ? 'palabra poco vista en la nómina'
    : s.motivo.includes('las dos como apellido') ? 'dos apellidos seguidos, no se sabe dónde cortar'
    : 'otro'
  porMotivo[k] = (porMotivo[k] || 0) + 1
}
console.log('\npor qué se quedan marcadas:')
for (const [k, v] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`)

// Tabla de evidencia por PALABRA (una palabra sola no identifica a nadie): es
// lo que hay que mirar para aprobar o rechazar la regla.
const palabras = new Map()
for (const r of cambian) {
  const u = unidades(r.nombre_completo)
  const clave = sinTildes(u[1] || '')
  if (!palabras.has(clave)) palabras.set(clave, { palabra: u[1], ...ev.clasificar(u[1]), fichas: 0 })
  palabras.get(clave).fichas++
}
console.log(`\nlas palabras que mueven el corte (${palabras.size} distintas, ${cambian.length} fichas):`)
console.log('  palabra               de 1ª (apellido)   de última (nombre)   decisión    fichas')
for (const p of [...palabras.values()].sort((a, b) => b.fichas - a.fichas).slice(0, 40)) {
  console.log(`  ${String(p.palabra).padEnd(20)} ${String(p.p).padStart(9)} ${String(p.l).padStart(20)}   ${p.clase.padEnd(9)} ${String(p.fichas).padStart(6)}`)
}

if (MUESTRA) {
  const payload = {
    generado: new Date().toISOString(),
    umbral: { min_obs: MIN_OBS, ratio: UMBRAL },
    resumen: {
      marcadas: dudosos.length, resuelve: resueltos.length, corrige: cambian.length,
      confirma: resueltos.length - cambian.length, sin_resolver: sinResolver.length,
    },
    muestra_de_cambios: cambian.slice(0, CUANTAS).map((r) => ({
      nombre_completo: r.nombre_completo,
      antes: { apellidos: r.antes_apellidos, nombres: r.antes_nombres },
      despues: { apellidos: r.apellidos, nombres: r.nombres },
      motivo: r.motivo,
    })),
    // Las confirmaciones también hay que mirarlas: ahí el corte no se mueve,
    // pero la ficha deja de estar marcada.
    muestra_de_confirmaciones: Object.keys(porRegla).flatMap((regla) =>
      resueltos.filter((r) => r.regla === regla && !r.cambia).slice(0, CUANTAS).map((r) => ({
        regla,
        nombre_completo: r.nombre_completo,
        queda: { apellidos: r.apellidos, nombres: r.nombres },
        motivo: r.motivo,
      }))
    ),
    muestra_sin_resolver: sinResolver.slice(0, CUANTAS).map((s) => ({
      nombre_completo: s.nombre_completo, motivo: s.motivo,
    })),
  }
  writeFileSync(MUESTRA, JSON.stringify(payload, null, 2), 'utf8')
  console.log(`\nmuestra para revisar: ${MUESTRA}`)
}

// ── Aplicación ───────────────────────────────────────────────────────────────
if (!APLICAR) {
  console.log('\nSimulación: no se escribió nada. Para aplicar: --aplicar\n')
  await c.end()
  process.exit(0)
}

await c.query('BEGIN')
let n = 0
for (const r of resueltos) {
  // `nombre_completo` en el WHERE: si la ficha cambió desde la simulación, no
  // se toca.
  const res = await c.query(
    `UPDATE personas SET apellidos = $2, nombres = $3, nombre_confianza = 'ALTA'
      WHERE id = $1 AND nombre_completo = $4`,
    [r.id, r.apellidos, r.nombres, r.nombre_completo]
  )
  n += res.rowCount
}
await c.query('COMMIT')
const quedan = (await c.query(
  `SELECT COUNT(*)::int n FROM vw_planta_inconsistencias WHERE motivo = 'NOMBRE_DUDOSO'`
)).rows[0].n
console.log(`\nactualizadas: ${n} fichas`)
console.log(`NOMBRE_DUDOSO en la vista: ${dudosos.length} → ${quedan}\n`)
await c.end()

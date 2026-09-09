// =============================================================================
// Mide la duración de los videos de despacho ya grabados
// =============================================================================
// Rellena `ordenes_insumo.video_duracion_s` de los videos que se subieron antes
// de que la aplicación midiera nada. Con eso, un despacho respaldado por un
// archivo vacío deja de verse como un rectángulo negro sin explicación.
//
// La duración NO sale de la cabecera: un WebM de MediaRecorder nunca la trae
// (el muxer la escribiría al cerrar el archivo, y estos se arman en vivo). Se
// saca recorriendo el archivo hasta el último bloque de imagen o sonido.
//
// Uso:
//   node scripts/medir-videos-despacho.mjs --dry-run
//   node scripts/medir-videos-despacho.mjs
// =============================================================================
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')

const env = readFileSync(join(root, '.env.local'), 'utf8')
const leer = (k) => (env.match(new RegExp(`^${k}="?([^"\n]+)"?`, 'm')) || [])[1]?.trim()
const SUPABASE_URL = leer('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = leer('SUPABASE_SERVICE_ROLE_KEY')
const DIRECT_URL = leer('DIRECT_URL')
if (!SUPABASE_URL || !SERVICE_KEY || !DIRECT_URL) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o DIRECT_URL en .env.local')
  process.exit(1)
}

// ── Lector de duración ───────────────────────────────────────────────────────
// Recorre el árbol EBML de verdad en vez de buscar bytes sueltos. Un primer
// intento «buscar el id de Cluster y leer su Timecode» daba 0,00 s para un video
// de 1 MB: Chrome mete varios segundos en un solo Cluster, así que el timecode
// del Cluster no dice cuánto dura. La duración real es la del último bloque.

const ID_SEGMENT = 0x18538067
const ID_INFO = 0x1549a966
const ID_TIMECODE_SCALE = 0x2ad7b1
const ID_CLUSTER = 0x1f43b675
const ID_TIMECODE = 0xe7
const ID_SIMPLE_BLOCK = 0xa3
const ID_BLOCK_GROUP = 0xa0

/** Lee un entero de longitud variable de EBML. `quitarMarca` para los tamaños. */
function leerVint(b, p, quitarMarca) {
  const cabeza = b[p]
  if (cabeza === undefined) return null
  let largo = 1
  for (let m = 0x80; m && !(cabeza & m); m >>= 1) largo++
  if (largo > 8 || p + largo > b.length) return null
  let valor = quitarMarca ? (cabeza & (0xff >> largo)) : cabeza
  for (let k = 1; k < largo; k++) valor = valor * 256 + b[p + k]
  return { valor, largo, desconocido: quitarMarca && valor === 2 ** (7 * largo) - 1 }
}

/** Segundos que abarca un WebM, más cuántos clusters y bloques trae. */
function duracionWebm(b) {
  let escala = 1000000            // TimecodeScale por defecto: 1 ms
  let maxNs = 0
  let clusters = 0
  let bloques = 0

  const recorrer = (ini, fin, dentroDeCluster, tcCluster) => {
    let p = ini
    while (p < fin) {
      const id = leerVint(b, p, false)
      if (!id) return
      const tam = leerVint(b, p + id.largo, true)
      if (!tam) return
      const datos = p + id.largo + tam.largo
      // Un tamaño «desconocido» (los que escribe un muxer en vivo) llega hasta
      // el final del padre.
      const finDatos = tam.desconocido ? fin : Math.min(fin, datos + tam.valor)

      if (id.valor === ID_SEGMENT || id.valor === ID_INFO) {
        recorrer(datos, finDatos, false, 0)
      } else if (id.valor === ID_TIMECODE_SCALE) {
        let v = 0
        for (let k = 0; k < tam.valor; k++) v = v * 256 + b[datos + k]
        if (v) escala = v
      } else if (id.valor === ID_CLUSTER) {
        clusters++
        let tc = 0
        const hijo = leerVint(b, datos, false)
        if (hijo && hijo.valor === ID_TIMECODE) {
          const tamHijo = leerVint(b, datos + hijo.largo, true)
          const d = datos + hijo.largo + tamHijo.largo
          for (let k = 0; k < tamHijo.valor; k++) tc = tc * 256 + b[d + k]
        }
        maxNs = Math.max(maxNs, tc * escala)
        recorrer(datos, finDatos, true, tc)
      } else if (dentroDeCluster && (id.valor === ID_SIMPLE_BLOCK || id.valor === ID_BLOCK_GROUP)) {
        const pista = leerVint(b, datos, true)
        if (pista && datos + pista.largo + 2 <= b.length) {
          maxNs = Math.max(maxNs, (tcCluster + b.readInt16BE(datos + pista.largo)) * escala)
          bloques++
        }
      }

      if (finDatos <= p) return          // sin avance: archivo corrupto
      p = finDatos
    }
  }

  recorrer(0, b.length, false, 0)
  return { segundos: maxNs / 1e9, clusters, bloques }
}

const cliente = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false } })
await cliente.connect()

const { rows: pendientes } = await cliente.query(`
  SELECT o.id, o.numero, o.video_path, (s.metadata ->> 'size')::BIGINT AS bytes
    FROM ordenes_insumo o
    LEFT JOIN storage.objects s
           ON s.bucket_id = 'ordenes-insumo' AND s.name = o.video_path
   WHERE o.video_path IS NOT NULL AND o.video_duracion_s IS NULL
   ORDER BY o.despachado_at DESC
`)

console.log('── Videos de despacho por medir ─────────────────────────')
console.log('Pendientes:', pendientes.length)

const H = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }
const medidos = []
const fallidos = []

for (const o of pendientes) {
  if (!o.bytes) { fallidos.push({ ...o, motivo: 'el archivo no está en el bucket' }); continue }
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/ordenes-insumo/${o.video_path}`, { headers: H })
    if (!r.ok) { fallidos.push({ ...o, motivo: `descarga ${r.status}` }); continue }
    const buf = Buffer.from(await r.arrayBuffer())
    const { segundos, bloques } = duracionWebm(buf)
    // Sin un solo bloque el archivo es la pura cabecera: cero segundos.
    medidos.push({ ...o, segundos: bloques === 0 ? 0 : segundos })
  } catch (e) {
    fallidos.push({ ...o, motivo: String(e).slice(0, 80) })
  }
  if (medidos.length % 25 === 0 && medidos.length) process.stdout.write(`  ${medidos.length}/${pendientes.length}\r`)
}
console.log(`  ${medidos.length}/${pendientes.length}`)

const cortos = medidos.filter((m) => m.segundos < 3)
console.log('\nMedidos            :', medidos.length)
console.log('  · de 3 s o más   :', medidos.length - cortos.length)
console.log('  · por debajo de 3s:', cortos.length, '← sin evidencia de despacho')
console.log('No se pudieron leer:', fallidos.length)

if (DRY) {
  console.log('\nEjemplos:')
  for (const m of medidos.slice(0, 8)) console.log(`  ${m.numero}  ${m.segundos.toFixed(2)} s  (${m.bytes} bytes)`)
  console.log('\n(--dry-run: no se escribió nada)')
} else if (medidos.length) {
  await cliente.query('BEGIN')
  for (const m of medidos) {
    await cliente.query('UPDATE ordenes_insumo SET video_duracion_s = $1 WHERE id = $2', [m.segundos.toFixed(2), m.id])
  }
  await cliente.query('COMMIT')
  console.log('\n✅ Duración guardada en', medidos.length, 'órdenes')
}

if (fallidos.length) {
  console.log('\nSin medir:')
  for (const f of fallidos.slice(0, 10)) console.log(`  ${f.numero}: ${f.motivo}`)
}

await cliente.end()

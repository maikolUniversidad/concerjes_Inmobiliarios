// Carga las plantillas de documentos de contratación en la base de datos.
//
// Cada archivo supabase/plantillas-documento/<CODIGO>.html trae en la primera
// línea un comentario `<!-- plantilla: {…json…} -->` con sus metadatos. El
// script:
//   · crea la plantilla si no existe (los metadatos NO se pisan después: se
//     editan desde Gestión Humana → Plantillas de documentos);
//   · publica la versión 1 si la plantilla no tiene versiones;
//   · con --nueva-version publica una versión nueva cuando el archivo cambió
//     respecto de la última versión (queda el historial completo);
//   · sube el archivo original (.doc/.docx/.xls) al bucket privado
//     `plantillas-documentos` si existe en supabase/plantillas-documento/originales.
//
// Uso:
//   NODE_OPTIONS=--use-system-ca node scripts/sembrar-plantillas-documento.mjs [--nueva-version]
import { createRequire } from 'module'
import { readFileSync, readdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'
import { fileURLToPath } from 'url'
import { dirname, join, extname } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const leer = (k) => env.match(new RegExp(`^${k}="?([^"\\n]+)"?`, 'm'))?.[1]?.trim()
const url = leer('DIRECT_URL')
const supaUrl = leer('NEXT_PUBLIC_SUPABASE_URL')
const serviceKey = leer('SUPABASE_SERVICE_ROLE_KEY')
if (!url) { console.error('Falta DIRECT_URL en .env.local'); process.exit(1) }
const nuevaVersion = process.argv.includes('--nueva-version')

const dir = join(root, 'supabase', 'plantillas-documento')
const originales = join(dir, 'originales')
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
// Originales disponibles por código (los formatos que solo existían escaneados no tienen).
const ORIGINALES = {
  CONTRATO_OBRA_LABOR: ['minuta-contrato-obra-labor.doc', 'application/msword'],
  FORMATO_ENTREVISTA: ['formato-entrevista-v4.docx', DOCX],
  AUTORIZACION_IMAGEN_HISTORIA_CLINICA: ['formato-entrevista-v4.docx', DOCX],
  CARTA_CONOCIMIENTO_FUNCIONES: ['carta-conocimiento-funciones.docx', DOCX],
  REQUISICION_PERSONAL: ['requisicion-personal-v3.xls', 'application/vnd.ms-excel'],
}

const RE_META = /^\s*<!--\s*plantilla:\s*(\{[\s\S]*?\})\s*-->\s*/
const RE_VAR = /\{\{\{?\s*([^{}]+?)\s*\}?\}\}/g
const RESERVADAS = new Set([
  'FIRMA_TRABAJADOR', 'FECHA_FIRMA', 'FIRMA_EMPLEADOR', 'FIRMA_TESTIGO1', 'FIRMA_TESTIGO2',
  'FIRMA_EVALUADOR', 'FIRMA_RESPONSABLE', 'HUELLA', 'HUELLA_IZQUIERDA', 'FOTO_CARNET',
])

function variablesDe(html) {
  const out = new Set()
  for (const m of html.matchAll(RE_VAR)) {
    const t = m[1].trim()
    if (RESERVADAS.has(t) || t === 'else' || t.startsWith('/')) continue
    const expr = t.replace(/^#(if|unless|each)\s+/, '')
    const ruta = expr.split('|')[0].trim()
    if (!ruta || ruta.startsWith('this') || ruta.startsWith('@')) continue
    out.add(ruta)
  }
  return [...out].sort()
}

async function subirOriginal(codigo) {
  const def = ORIGINALES[codigo]
  if (!def || !supaUrl || !serviceKey) return null
  const ruta = join(originales, def[0])
  if (!existsSync(ruta)) return null
  const destino = `${codigo}/original${extname(def[0])}`
  const res = await fetch(`${supaUrl}/storage/v1/object/plantillas-documentos/${destino}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': def[1], 'x-upsert': 'true' },
    body: readFileSync(ruta),
  })
  if (!res.ok) {
    console.warn(`  ⚠ no se pudo subir el original de ${codigo}: ${res.status} ${await res.text()}`)
    return null
  }
  return { path: destino, nombre: def[0] }
}

const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } })
await client.connect()

const archivos = readdirSync(dir).filter((f) => f.endsWith('.html')).sort()
let creadas = 0, versiones = 0, subidos = 0
for (const archivo of archivos) {
  const codigo = archivo.replace(/\.html$/, '')
  const crudo = readFileSync(join(dir, archivo), 'utf8').replace(/\r\n/g, '\n')
  const m = RE_META.exec(crudo)
  if (!m) { console.warn(`⚠ ${archivo}: sin metadatos, se omite`); continue }
  const meta = JSON.parse(m[1])
  const cuerpo = crudo.slice(m[0].length).trim() + '\n'
  const sha = createHash('sha256').update(cuerpo).digest('hex')

  await client.query('BEGIN')
  try {
    let { rows: [pl] } = await client.query('SELECT id, version_vigente FROM plantillas_documento WHERE codigo = $1', [codigo])
    if (!pl) {
      const r = await client.query(
        `INSERT INTO plantillas_documento (codigo, nombre, descripcion, categoria, momento, orden, obligatoria, activa, es_sistema,
            requiere_firma_trabajador, requiere_firma_empleador, requiere_testigos, requiere_huella, requiere_contrato,
            visible_candidato, permite_firma_electronica, codigo_formato)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,true,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, version_vigente`,
        [codigo, meta.nombre, meta.descripcion ?? null, meta.categoria ?? 'FORMATO', meta.momento ?? 'CONTRATACION', meta.orden ?? 0,
          meta.obligatoria ?? true, meta.requiere_firma_trabajador ?? true, meta.requiere_firma_empleador ?? false,
          meta.requiere_testigos ?? false, meta.requiere_huella ?? false, meta.requiere_contrato ?? false,
          meta.visible_candidato ?? true, meta.permite_firma_electronica ?? true, meta.codigo_formato ?? null])
      pl = r.rows[0]
      creadas++
    }
    const { rows: [ult] } = await client.query(
      'SELECT version, sha256 FROM plantilla_versiones WHERE plantilla_id = $1 ORDER BY version DESC LIMIT 1', [pl.id])
    if (!ult || (nuevaVersion && ult.sha256 !== sha)) {
      const version = (ult?.version ?? 0) + 1
      const nota = version === 1
        ? `Versión digital inicial.${meta.codigo_formato ? ' Formato físico: ' + meta.codigo_formato + '.' : ''}`
        : 'Actualizada desde el repositorio.'
      await client.query(
        `INSERT INTO plantilla_versiones (plantilla_id, version, cuerpo_html, variables, notas, sha256, publicada, creado_por_nombre)
         VALUES ($1,$2,$3,$4,$5,$6,true,'Carga inicial (sistema)')`,
        [pl.id, version, cuerpo, variablesDe(cuerpo), nota, sha])
      versiones++
      console.log(`✔ ${codigo} → versión ${version}`)
    } else {
      console.log(`· ${codigo} sin cambios (v${ult.version})`)
    }
    await client.query('COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error(`✖ ${codigo}: ${e.message}`)
    continue
  }

  const orig = await subirOriginal(codigo)
  if (orig) {
    await client.query('UPDATE plantillas_documento SET archivo_original_path = $2, archivo_original_nombre = $3 WHERE codigo = $1',
      [codigo, orig.path, orig.nombre])
    subidos++
  }
}
console.log(`\nPlantillas nuevas: ${creadas} · versiones publicadas: ${versiones} · originales subidos: ${subidos}`)
await client.end()

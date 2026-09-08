// =============================================================================
// Cargue de la planta de personal desde los informes de nómina (Excel)
// =============================================================================
// Lee los dos exportes de nómina y los deja en `personas`, `centros_costo` y
// `persona_vinculaciones`:
//
//   · «Informe de Personal Por Cargos»       → la gente que está hoy en planta
//   · «Informe Personal por Fecha de Retiro» → quién salió y cuándo
//
// Los dos son informes AGRUPADOS: la ciudad y el cargo solo se imprimen cuando
// cambian, así que hay que arrastrar el último valor hacia abajo.
//
// Es idempotente: cada vinculación lleva una `clave_origen` derivada del
// documento (y de la fecha de retiro), así que volver a correrlo actualiza en
// vez de duplicar. Lo digitado a mano en una ficha (correo, teléfono, nombres)
// no se pisa: la nómina solo rellena lo que esté vacío.
//
// Uso:
//   node scripts/importar-planta-personal.mjs --dry-run
//   node scripts/importar-planta-personal.mjs
//   node scripts/importar-planta-personal.mjs --activos <ruta> --retirados <ruta>
//   node scripts/importar-planta-personal.mjs --dry-run --muestra C:/tmp/planta.json
// =============================================================================
import { createRequire } from 'module'
import { readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const args = process.argv.slice(2)
const flag = (n, def) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def
}
const DRY = args.includes('--dry-run')
const DESCARGA = 'C:/Users/maiko/Downloads/Concerjes Activos'
const RUTA_ACTIVOS = flag('activos', `${DESCARGA}/ExportExcel activos conserjes.xlsx`)
const RUTA_RETIRADOS = flag('retirados', `${DESCARGA}/ExportExcel Retirados Conserjes.xlsx`)

// ── Lectura del Excel ────────────────────────────────────────────────────────
// La fila 4 es el encabezado; encima van el nombre de la empresa y el título.
async function leerHoja(ruta) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(ruta)
  const ws = wb.worksheets[0]
  const encabezado = []
  ws.getRow(4).eachCell({ includeEmpty: true }, (c, i) => { encabezado[i - 1] = String(c.value ?? '').trim() })
  const filas = []
  for (let n = 5; n <= ws.rowCount; n++) {
    const fila = {}
    let vacia = true
    ws.getRow(n).eachCell({ includeEmpty: true }, (c, i) => {
      const k = encabezado[i - 1]
      if (!k) return
      let v = c.value
      if (v && typeof v === 'object' && 'result' in v) v = v.result
      if (v && typeof v === 'object' && 'text' in v) v = v.text
      fila[k] = v
      if (v !== null && v !== undefined && String(v).trim() !== '') vacia = false
    })
    if (!vacia) filas.push(fila)
  }
  return { encabezado, filas }
}

const txt = (v) => (v === null || v === undefined ? '' : String(v).trim())
const fecha = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  // Las fechas del Excel llegan a medianoche UTC; se toma la parte de fecha tal
  // cual para no correrlas un día al pasar a la zona local.
  return d.toISOString().slice(0, 10)
}

// En el informe de retirados, teléfono y dirección vienen rellenados con
// decenas de espacios y con OTRO valor de nómina pegado detrás
// («3023182644·············12153»). Se corta en la primera tanda larga de
// espacios y se conserva solo el dato de contacto.
const primerCampo = (v) => txt(v).split(/\s{3,}/)[0].trim()
const telefono = (v) => {
  const t = primerCampo(v).split(/\s+/)[0].replace(/[^\d+]/g, '')
  return t ? t.slice(0, 30) : null
}
const direccion = (v) => {
  const d = primerCampo(v).replace(/\s+/g, ' ')
  return d ? d.slice(0, 200) : null
}
// El documento es la llave: si viniera más largo que la columna se perdería la
// identidad, así que se normaliza a dígitos y se avisa si aún no cabe.
const documentoLimpio = (v) => {
  const d = txt(v).replace(/[^\dA-Za-z]/g, '')
  if (d.length > 30) throw new Error(`Documento demasiado largo: ${d}`)
  return d
}
const recorta = (v, n) => {
  const t = txt(v)
  return t ? t.slice(0, n) : null
}

// ── Ciudad / departamento ────────────────────────────────────────────────────
// 'Ciudad: BARRANCABERMEJA Depto: SANTANDER' → { ciudad, departamento }
function partirCentroTrabajo(s) {
  const t = txt(s)
  if (!t) return { ciudad: null, departamento: null }
  const m = t.match(/Ciudad:\s*(.*?)\s*(?:Depto:\s*(.*))?$/i)
  if (!m) return { ciudad: t.toUpperCase(), departamento: null }
  return {
    ciudad: (m[1] || '').trim().toUpperCase() || null,
    departamento: (m[2] || '').trim().toUpperCase() || null,
  }
}

// 'TRANSMILENIO 2026-BOGOTA' → nombre 'TRANSMILENIO 2026', ciudad 'BOGOTA'
function partirCentroCosto(codigo) {
  const c = txt(codigo)
  if (!c) return null
  const i = c.lastIndexOf('-')
  const nombre = i > 0 ? c.slice(0, i).trim() : c
  const ciudad = i > 0 ? c.slice(i + 1).trim().toUpperCase() : null
  return {
    codigo: c,
    nombre,
    ciudad,
    es_disponibilidad: /^DISPONIBLE\b/i.test(nombre),
    es_administrativo: /\b(ADM|ADMINISTRATIV|OPERACIONES|GERENCIA)\b/i.test(nombre),
  }
}

// ── Corte entre apellidos y nombres ──────────────────────────────────────────
// Los informes traen «Apellidos y Nombres» en un solo campo y no hay separador.
// En vez de adivinar por el número de palabras (3 palabras tanto puede ser
// 1 apellido + 2 nombres —GAMEZ BLANCA INES— como 2 apellidos + 1 nombre
// —RIVERA PACHECO EDUARDO—), se aprende del propio archivo: la última palabra
// de un nombre completo SIEMPRE es un nombre de pila y la primera SIEMPRE es un
// apellido, así que la frecuencia de cada palabra en esas dos posiciones dice
// de qué lado cae.
const PARTICULAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'LOS', 'SAN', 'SANTA', 'VAN', 'VON', 'DA', 'DI', 'DO', 'DOS'])

const sinTildes = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()

// Pega las partículas a la palabra que sigue: 'DE LA HOZ' es una sola unidad.
function unidades(nombreCompleto) {
  const t = txt(nombreCompleto).replace(/\s+/g, ' ').split(' ').filter(Boolean)
  const out = []
  let buffer = []
  for (const p of t) {
    if (PARTICULAS.has(sinTildes(p))) { buffer.push(p); continue }
    out.push([...buffer, p].join(' '))
    buffer = []
  }
  if (buffer.length) out.push(buffer.join(' '))   // partícula suelta al final
  return out
}

function construirDiccionario(nombres) {
  const primera = new Map()
  const ultima = new Map()
  const sube = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  for (const n of nombres) {
    const u = unidades(n)
    if (u.length < 2) continue
    sube(primera, sinTildes(u[0]))
    sube(ultima, sinTildes(u[u.length - 1]))
  }
  // Laplace para que una palabra vista una sola vez no se vaya a un extremo.
  const puntaje = (unidad) => {
    const k = sinTildes(unidad)
    const p = primera.get(k) || 0
    const l = ultima.get(k) || 0
    return (l + 1) / (p + l + 2)
  }
  return { puntaje }
}

// Devuelve { apellidos, nombres, confianza }
function partirNombre(nombreCompleto, dic) {
  const u = unidades(nombreCompleto)
  if (u.length === 0) return { apellidos: '', nombres: '', confianza: 'BAJA' }
  if (u.length === 1) return { apellidos: u[0], nombres: '', confianza: 'BAJA' }
  if (u.length === 2) return { apellidos: u[0], nombres: u[1], confianza: 'BAJA' }

  // Por defecto, dos apellidos. Se baja a uno solo cuando la segunda palabra
  // se comporta claramente como nombre de pila (BLANCA, MARIA, JUAN…).
  let corte = 2
  let confianza = 'ALTA'
  const p1 = dic.puntaje(u[1])
  const p0 = dic.puntaje(u[0])
  if (p1 > 0.65 && p0 < 0.5) corte = 1
  else if (p1 > 0.5) confianza = 'MEDIA'          // zona gris: revisar a mano
  if (u.length === 3 && corte === 2 && p1 > 0.4) confianza = 'MEDIA'
  if (corte >= u.length) corte = u.length - 1

  return {
    apellidos: u.slice(0, corte).join(' '),
    nombres: u.slice(corte).join(' '),
    confianza,
  }
}

// ── Armado del lote ──────────────────────────────────────────────────────────
async function construirLote() {
  const activos = await leerHoja(RUTA_ACTIVOS)
  const retirados = await leerHoja(RUTA_RETIRADOS)

  const colNomina = activos.encabezado.find((h) => h.startsWith('Tipo de N')) || 'Tipo de Nomina'

  // Arrastre de los encabezados de grupo (ciudad y cargo solo salen al cambiar).
  let ciudadAct = null, deptoAct = null, cargoAct = null
  const filasActivos = activos.filas.map((f) => {
    // El informe suprime el valor repetido en TODA la columna, no por ciudad:
    // una celda de cargo vacía significa «el mismo de la fila anterior», aunque
    // arriba haya cambiado la ciudad.
    if (txt(f['CentroTrabajo'])) {
      const c = partirCentroTrabajo(f['CentroTrabajo'])
      ciudadAct = c.ciudad; deptoAct = c.departamento
    }
    if (txt(f['Cargo_Centros'])) cargoAct = txt(f['Cargo_Centros']).toUpperCase()
    return {
      documento: documentoLimpio(f['Identificacion']),
      nombre_completo: recorta(f['Nombres'], 240),
      cargo: recorta(cargoAct, 120),
      ciudad: recorta(ciudadAct, 120),
      departamento: recorta(deptoAct, 120),
      codigo_empleado: recorta(f['CodEmpleado'], 30),
      centro_costo: recorta(f['Centro de Costos'], 160),
      tipo_nomina: recorta(f[colNomina], 160),
      salario: f['Salario'] ? Number(f['Salario']) : null,
    }
  }).filter((f) => f.documento)

  let ciudadRet = null, deptoRet = null
  const filasRetirados = retirados.filas.map((f) => {
    if (txt(f['CentroTrabajo'])) {
      const c = partirCentroTrabajo(f['CentroTrabajo'])
      ciudadRet = c.ciudad; deptoRet = c.departamento
    }
    return {
      documento: documentoLimpio(f['Identificacion']),
      nombre_completo: recorta(f['Apellidos y Nombres'], 240),
      codigo_empleado: recorta(f['Codigo Empleado'], 30),
      direccion: direccion(f['Direccion Empleado']),
      telefono: telefono(f['Numero Telefonico']),
      fecha_ingreso: fecha(f['Fecha de Ingreso']),
      periodo_prueba: txt(f['Periodo Prueba']) || null,
      fecha_fin_contrato: fecha(f['Fecha Fin Contrato']),
      fecha_retiro: fecha(f['Fecha de Retiro']),
      tipo_contrato: txt(f['Tipo de Contrato']) || null,
      ciudad: ciudadRet,
      departamento: deptoRet,
    }
  }).filter((f) => f.documento)

  // El diccionario se arma con TODOS los nombres de los dos archivos: entre más
  // ejemplos, mejor separa apellidos de nombres de pila.
  const dic = construirDiccionario([
    ...filasActivos.map((f) => f.nombre_completo),
    ...filasRetirados.map((f) => f.nombre_completo),
  ])

  // Una ficha por documento. Se procesan primero los retiros y encima los
  // activos, para que quien salió y volvió a entrar quede ACTIVO.
  const personas = new Map()
  const upsertPersona = (doc, datos) => {
    const previa = personas.get(doc) || { documento: doc }
    // El primer valor no nulo gana, salvo que venga de la hoja de activos
    // (`pisa: true`), que es la foto vigente de nómina.
    for (const [k, v] of Object.entries(datos)) {
      if (v === null || v === undefined || v === '') continue
      if (datos.__pisa || previa[k] === undefined || previa[k] === null) previa[k] = v
    }
    delete previa.__pisa
    personas.set(doc, previa)
  }

  const vinculaciones = []

  for (const f of filasRetirados) {
    const n = partirNombre(f.nombre_completo, dic)
    upsertPersona(f.documento, {
      nombre_completo: f.nombre_completo,
      nombres: n.nombres, apellidos: n.apellidos, nombre_confianza: n.confianza,
      ciudad: f.ciudad, departamento: f.departamento,
      telefono: f.telefono, direccion: f.direccion,
      codigo_empleado: f.codigo_empleado,
      tipo_contrato: f.tipo_contrato,
      fecha_ingreso: f.fecha_ingreso,
      fecha_retiro: f.fecha_retiro,
      estado: 'RETIRADO',
    })
    vinculaciones.push({
      documento: f.documento,
      clave_origen: `RET:${f.documento}:${f.fecha_retiro || 'SF'}`,
      centro_costo: null,
      cargo: null,
      tipo_contrato: f.tipo_contrato,
      codigo_empleado: f.codigo_empleado,
      tipo_nomina: null,
      salario: null,
      fecha_ingreso: f.fecha_ingreso,
      periodo_prueba: f.periodo_prueba,
      fecha_fin_contrato: f.fecha_fin_contrato,
      fecha_retiro: f.fecha_retiro,
      estado: 'TERMINADA',
    })
  }

  for (const f of filasActivos) {
    const n = partirNombre(f.nombre_completo, dic)
    upsertPersona(f.documento, {
      __pisa: true,
      nombre_completo: f.nombre_completo,
      nombres: n.nombres, apellidos: n.apellidos, nombre_confianza: n.confianza,
      cargo: f.cargo, ciudad: f.ciudad, departamento: f.departamento,
      codigo_empleado: f.codigo_empleado,
      centro_costo: f.centro_costo,
      tipo_nomina: f.tipo_nomina,
      salario: f.salario,
      estado: 'ACTIVO',
      fecha_retiro: null,
    })
    // Quien vuelve a entrar deja de tener fecha de retiro en la ficha; el retiro
    // anterior sigue vivo en su historial de vinculaciones. La fecha de ingreso
    // también se limpia: el informe de activos no la trae, y la del informe de
    // retiros pertenece al paso ANTERIOR por la empresa, no al de ahora.
    const p = personas.get(f.documento)
    p.fecha_retiro = null
    p.fecha_ingreso = null
    p.estado = 'ACTIVO'

    vinculaciones.push({
      documento: f.documento,
      clave_origen: `ACT:${f.documento}`,
      centro_costo: f.centro_costo,
      cargo: f.cargo,
      tipo_contrato: null,
      codigo_empleado: f.codigo_empleado,
      tipo_nomina: f.tipo_nomina,
      salario: f.salario,
      fecha_ingreso: null,            // el informe de activos no la trae
      periodo_prueba: null,
      fecha_fin_contrato: null,
      fecha_retiro: null,
      estado: 'ACTIVA',
    })
  }

  const centros = new Map()
  for (const f of filasActivos) {
    const c = partirCentroCosto(f.centro_costo)
    if (c && !centros.has(c.codigo)) centros.set(c.codigo, c)
  }
  const cargos = [...new Set(filasActivos.map((f) => f.cargo).filter(Boolean))]

  return {
    personas: [...personas.values()],
    vinculaciones,
    centros: [...centros.values()],
    cargos,
    conteos: {
      filasActivos: filasActivos.length,
      filasRetirados: filasRetirados.length,
      documentosEnAmbos: filasActivos.filter((a) => filasRetirados.some((r) => r.documento === a.documento)).length,
    },
  }
}

// ── Escritura ────────────────────────────────────────────────────────────────
function conexion() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
  if (!m) throw new Error('No se encontró DIRECT_URL en .env.local')
  return new Client({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } })
}

const trozos = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n))

async function escribir(lote) {
  const c = conexion()
  await c.connect()
  const resumen = {}
  try {
    await c.query('BEGIN')

    // 1) Centros de costo
    for (const g of trozos(lote.centros, 200)) {
      const vals = g.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`).join(',')
      await c.query(
        `INSERT INTO centros_costo (codigo,nombre,ciudad,es_disponibilidad,es_administrativo,activo)
         VALUES ${vals}
         ON CONFLICT (codigo) DO UPDATE SET nombre = EXCLUDED.nombre, ciudad = EXCLUDED.ciudad,
           es_disponibilidad = EXCLUDED.es_disponibilidad, es_administrativo = EXCLUDED.es_administrativo`,
        g.flatMap((x) => [x.codigo, x.nombre, x.ciudad, x.es_disponibilidad, x.es_administrativo, true])
      )
    }
    resumen.centros = lote.centros.length

    // 2) Cargos (catálogo compartido con el ATS)
    for (const g of trozos(lote.cargos, 200)) {
      const vals = g.map((_, i) => `($${i + 1})`).join(',')
      await c.query(`INSERT INTO cargos (nombre) VALUES ${vals} ON CONFLICT (nombre) DO NOTHING`, g)
    }
    resumen.cargos = lote.cargos.length

    // 3) Personas. COALESCE en las columnas digitables: la nómina rellena, no pisa.
    // Nombres del VALUES de origen: trae el CÓDIGO del centro de costos, que en
    // el SELECT se resuelve al id.
    const cols = ['documento', 'nombre_completo', 'nombres', 'apellidos', 'nombre_confianza', 'cargo',
      'ciudad', 'departamento', 'telefono', 'direccion', 'codigo_empleado', 'tipo_nomina',
      'salario', 'tipo_contrato', 'fecha_ingreso', 'fecha_retiro', 'estado', 'centro_costo', 'origen']
    for (const g of trozos(lote.personas, 400)) {
      const vals = g.map((_, i) => `(${cols.map((__, j) => `$${i * cols.length + j + 1}`).join(',')})`).join(',')
      const params = g.flatMap((p) => [
        p.documento, p.nombre_completo || null, p.nombres || null, p.apellidos || null,
        p.nombre_confianza || null, p.cargo || null, p.ciudad || null, p.departamento || null,
        p.telefono || null, p.direccion || null, p.codigo_empleado || null, p.tipo_nomina || null,
        p.salario ?? null, p.tipo_contrato || null, p.fecha_ingreso || null, p.fecha_retiro || null,
        p.estado || 'ACTIVO', p.centro_costo || null, 'IMPORTACION_NOMINA',
      ])
      await c.query(
        `INSERT INTO personas (${cols.slice(0, -2).join(',')}, centro_costo_id, origen)
         -- Los parámetros de un VALUES sin tipo llegan como texto: hay que
         -- castear a mano lo numérico y las fechas o el INSERT no compila.
         SELECT documento, nombre_completo, nombres, apellidos, nombre_confianza, cargo, ciudad,
                departamento, telefono, direccion, codigo_empleado, tipo_nomina, salario::numeric,
                tipo_contrato, fecha_ingreso::date, fecha_retiro::date, estado,
                (SELECT id FROM centros_costo cc WHERE cc.codigo = e.centro_costo), origen
           FROM (VALUES ${vals}) AS e(${cols.join(',')})
         ON CONFLICT (documento) DO UPDATE SET
           nombre_completo  = EXCLUDED.nombre_completo,
           nombres          = COALESCE(NULLIF(personas.nombres,''), EXCLUDED.nombres),
           apellidos        = COALESCE(NULLIF(personas.apellidos,''), EXCLUDED.apellidos),
           nombre_confianza = EXCLUDED.nombre_confianza,
           cargo            = COALESCE(EXCLUDED.cargo, personas.cargo),
           ciudad           = COALESCE(EXCLUDED.ciudad, personas.ciudad),
           departamento     = COALESCE(EXCLUDED.departamento, personas.departamento),
           telefono         = COALESCE(NULLIF(personas.telefono,''), EXCLUDED.telefono),
           direccion        = COALESCE(NULLIF(personas.direccion,''), EXCLUDED.direccion),
           codigo_empleado  = COALESCE(EXCLUDED.codigo_empleado, personas.codigo_empleado),
           tipo_nomina      = COALESCE(EXCLUDED.tipo_nomina, personas.tipo_nomina),
           salario          = COALESCE(EXCLUDED.salario, personas.salario),
           tipo_contrato    = COALESCE(EXCLUDED.tipo_contrato, personas.tipo_contrato),
           fecha_ingreso    = CASE WHEN EXCLUDED.estado = 'ACTIVO' THEN NULL
                                   ELSE COALESCE(personas.fecha_ingreso, EXCLUDED.fecha_ingreso) END,
           fecha_retiro     = EXCLUDED.fecha_retiro,
           estado           = EXCLUDED.estado,
           centro_costo_id  = COALESCE(EXCLUDED.centro_costo_id, personas.centro_costo_id),
           origen           = 'IMPORTACION_NOMINA',
           updated_at       = NOW()`,
        params.map((v, i) => {
          // El VALUES sin tipos deja todo como texto; las columnas tipadas se
          // castean en el SELECT de arriba vía la tabla destino, salvo estas.
          const col = cols[i % cols.length]
          if (col === 'salario' && v !== null) return String(v)
          return v
        })
      )
    }
    resumen.personas = lote.personas.length

    // 4) Vinculaciones (historial laboral)
    const vc = ['documento', 'clave_origen', 'centro_costo', 'cargo', 'tipo_contrato', 'codigo_empleado',
      'tipo_nomina', 'salario', 'fecha_ingreso', 'periodo_prueba', 'fecha_fin_contrato',
      'fecha_retiro', 'estado']
    for (const g of trozos(lote.vinculaciones, 400)) {
      const vals = g.map((_, i) => `(${vc.map((__, j) => `$${i * vc.length + j + 1}`).join(',')})`).join(',')
      const params = g.flatMap((v) => [
        v.documento, v.clave_origen, v.centro_costo, v.cargo, v.tipo_contrato, v.codigo_empleado,
        v.tipo_nomina, v.salario === null ? null : String(v.salario), v.fecha_ingreso,
        v.periodo_prueba, v.fecha_fin_contrato, v.fecha_retiro, v.estado,
      ])
      await c.query(
        `INSERT INTO persona_vinculaciones
           (persona_id, clave_origen, centro_costo_id, cargo, cargo_id, tipo_contrato, codigo_empleado,
            tipo_nomina, salario, fecha_ingreso, periodo_prueba, fecha_fin_contrato, fecha_retiro,
            estado, origen)
         SELECT p.id, e.clave_origen,
                (SELECT id FROM centros_costo cc WHERE cc.codigo = e.centro_costo),
                e.cargo,
                (SELECT id FROM cargos ca WHERE ca.nombre = e.cargo),
                e.tipo_contrato, e.codigo_empleado, e.tipo_nomina, e.salario::numeric,
                e.fecha_ingreso::date, e.periodo_prueba, e.fecha_fin_contrato::date,
                e.fecha_retiro::date, e.estado, 'IMPORTACION_NOMINA'
           FROM (VALUES ${vals}) AS e(${vc.join(',')})
           JOIN personas p ON p.documento = e.documento
         ON CONFLICT (clave_origen) DO UPDATE SET
           centro_costo_id    = EXCLUDED.centro_costo_id,
           cargo              = EXCLUDED.cargo,
           cargo_id           = EXCLUDED.cargo_id,
           tipo_contrato      = EXCLUDED.tipo_contrato,
           codigo_empleado    = EXCLUDED.codigo_empleado,
           tipo_nomina        = EXCLUDED.tipo_nomina,
           salario            = EXCLUDED.salario,
           fecha_ingreso      = EXCLUDED.fecha_ingreso,
           periodo_prueba     = EXCLUDED.periodo_prueba,
           fecha_fin_contrato = EXCLUDED.fecha_fin_contrato,
           fecha_retiro       = EXCLUDED.fecha_retiro,
           estado             = EXCLUDED.estado,
           updated_at         = NOW()`,
        params
      )
    }
    resumen.vinculaciones = lote.vinculaciones.length

    // 5) Bitácora del cargue
    await c.query(
      `INSERT INTO importaciones (entidad, archivo_nombre, total, creados, actualizados, errores, detalle)
       VALUES ('planta_personal', $1, $2, 0, 0, 0, $3)`,
      [`${RUTA_ACTIVOS} + ${RUTA_RETIRADOS}`, lote.personas.length, JSON.stringify({ ...resumen, ...lote.conteos })]
    )

    await c.query('COMMIT')
  } catch (e) {
    await c.query('ROLLBACK')
    throw e
  } finally {
    await c.end()
  }
  return resumen
}

// ── Main ─────────────────────────────────────────────────────────────────────
const lote = await construirLote()

const porConfianza = lote.personas.reduce((a, p) => {
  a[p.nombre_confianza || 'SIN'] = (a[p.nombre_confianza || 'SIN'] || 0) + 1
  return a
}, {})

console.log('── Planta de personal ───────────────────────────────────')
console.log('Filas activos          :', lote.conteos.filasActivos)
console.log('Filas retirados        :', lote.conteos.filasRetirados)
console.log('Documentos en ambos    :', lote.conteos.documentosEnAmbos, '(retirados que volvieron a entrar)')
console.log('Personas únicas        :', lote.personas.length)
console.log('  · activas            :', lote.personas.filter((p) => p.estado === 'ACTIVO').length)
console.log('  · retiradas          :', lote.personas.filter((p) => p.estado === 'RETIRADO').length)
console.log('Vinculaciones          :', lote.vinculaciones.length)
console.log('Centros de costo       :', lote.centros.length)
console.log('Cargos                 :', lote.cargos.length)
console.log('Corte del nombre       :', JSON.stringify(porConfianza))
console.log('Sin ciudad             :', lote.personas.filter((p) => !p.ciudad).length)
console.log('Activos sin centro cost:', lote.personas.filter((p) => p.estado === 'ACTIVO' && !p.centro_costo).length)

// La muestra lleva nombres, documentos y teléfonos, así que NO va al repo: se
// escribe en la carpeta temporal, o donde diga --muestra.
const muestra = flag('muestra', join(tmpdir(), 'muestra-planta-personal.json'))
writeFileSync(muestra, JSON.stringify({
  conteos: lote.conteos,
  porConfianza,
  ejemploPersonas: lote.personas.slice(0, 15),
  ejemploDudosos: lote.personas.filter((p) => p.nombre_confianza === 'BAJA').slice(0, 20),
  centros: lote.centros,
  cargos: lote.cargos,
}, null, 2))
console.log('\nMuestra escrita en', muestra)

if (DRY) {
  console.log('\n(--dry-run: no se escribió nada en la base de datos)')
} else {
  const r = await escribir(lote)
  console.log('\n✅ Cargue aplicado:', JSON.stringify(r))
}

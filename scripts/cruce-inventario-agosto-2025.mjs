/**
 * Cruce del catalogo de productos contra el ULTIMO inventario fisico.
 *
 *   node scripts/cruce-inventario-agosto-2025.mjs --dry     (solo reporta)
 *   node scripts/cruce-inventario-agosto-2025.mjs           (aplica en BD)
 *
 * Fuente: "AGOSTO  2025.xlsx" (hoja "Hoja1")
 *   Columnas: ITEM | NOMBRE ESTANDAR | PRESENTACION | CANTIDADES
 *
 * Reglas del cruce:
 *   1. Producto que YA existe (match por `codigo` = ITEM del archivo)
 *        -> stock (cantidad_real = cantidad_disp) = CANTIDADES
 *        -> activo = true
 *        -> etiqueta: inventario_periodo = PERIODO, inventario_encontrado = true
 *        -> nombre/presentacion NO se sobreescriben si ya tienen valor; las
 *           diferencias se reportan para revision manual.
 *   2. ITEM del archivo que corresponde a un producto que ya existe en la BD
 *        pero SIN codigo (ver ENLACES) -> se le asigna el codigo del archivo
 *        y se trata como el caso 1 (sin duplicarlo).
 *   3. ITEM del archivo sin equivalente en la BD -> se inserta producto nuevo
 *        (tipo OTROS, cat C, activo) + su registro de stock.
 *   4. Producto de la BD que NO aparece en el archivo -> SE CONSERVA tal cual
 *        (no se borra, no se desactiva, no se toca su stock) y se etiqueta
 *        con inventario_encontrado = false para poder identificarlo.
 *
 * Todo corre dentro de una unica transaccion.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const PERIODO    = 'AGOSTO 2025'
const EXCEL_PATH = 'C:/Users/maiko/Downloads/Concerjes/AGOSTO  2025.xlsx'
const HOJA       = 'Hoja1'
const DRY        = process.argv.includes('--dry')
// El simulacro escribe en un archivo aparte para no pisar el reporte real
const REPORTE    = join(root, 'docs', DRY ? 'cruce-inventario-agosto-2025-simulacro.xlsx'
                                          : 'cruce-inventario-agosto-2025.xlsx')

/**
 * ITEMs del archivo que ya existian en la BD como productos SIN codigo.
 * Se enlazan por id (verificando el nombre) para no duplicar el catalogo.
 * El nombre y la presentacion se conservan los de la BD (mas limpios que los
 * del archivo); solo se les asigna el codigo y la cantidad contada.
 */
const ENLACES = [
  { item: 739, id: '324d91a8-5f8a-424e-b497-5cb92388affd', nombre: 'COLOMBINAS Y/O HITOS' },
  { item: 740, id: 'c5117258-c43b-487a-a1e4-b1b61f056279', nombre: 'GORRO DESECHABLE TIPO COFIA NEGRO' },
  { item: 741, id: '9fbab5f6-39c7-4d60-a487-cbdb164f0ff5', nombre: 'DESINFECTANTE LIMPIADOR PISO Y PAREDES' },
  { item: 743, id: 'fd5b2993-01ea-4b53-8b4c-761fbdac4ec3', nombre: 'Espatula Metalica De 4 "' },
  { item: 744, id: '85a8f12c-ba01-4644-976a-2442c8a133d5', nombre: 'Aromatica hindu de hierbas en infusion' },
]

/**
 * ITEMs del archivo que son el MISMO insumo que otro ITEM (el archivo trae el
 * insumo repetido con dos nombres). El item origen no se crea como producto:
 * su conteo se aplica al item destino, que es el que se conserva.
 *   742 "COFIAS NEGRAS" == 740 "GORRO DESECHABLE TIPO COFIA NEGRO"
 *   (el 740 vino con la celda de cantidad vacia y el 742 con las 300 unidades)
 */
const FUSIONES = { 742: 740 }

// -- helpers ----------------------------------------------------------------
const cv = cell => {
  const v = cell ? cell.value : null
  if (v === null || v === undefined) return null
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('')
    if (v.text !== undefined) return v.text
    if (v.result !== undefined) return v.result
    return null
  }
  return v
}
const str  = v => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().replace(/\s+/g, ' '))
const norm = v => (v ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase()
const num  = v => {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(/[,$\s]/g, ''))
  return Number.isNaN(n) ? null : n
}

function dbUrl() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
  if (!m) throw new Error('No se encontro DIRECT_URL en .env.local')
  return m[1].trim()
}

// -- 1. Leer el inventario --------------------------------------------------
async function leerExcel() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(EXCEL_PATH)
  const ws = wb.getWorksheet(HOJA)
  if (!ws) throw new Error(`No se encontro la hoja "${HOJA}"`)

  const file = new Map() // codigo -> { nombre, presentacion, cantidad }
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cod = num(cv(row.getCell(1)))
    const nombre = str(cv(row.getCell(2)))
    if (cod === null || !Number.isFinite(cod) || cod < 1 || !nombre) continue
    if (file.has(cod)) throw new Error(`ITEM ${cod} duplicado en el archivo (fila ${r})`)
    file.set(cod, { nombre, presentacion: str(cv(row.getCell(3))), cantidad: num(cv(row.getCell(4))) })
  }
  return file
}

async function main() {
  console.log(`Leyendo inventario ${PERIODO} ...`)
  const file = await leerExcel()
  console.log(`   ${file.size} productos contados en el archivo\n`)

  const client = new Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log(`Conectado a Supabase${DRY ? '  (modo --dry: no se escribe nada)' : ''}\n`)

  const rep = { actualizados: [], enlazados: [], nuevos: [], fusionados: [], sinCantidad: [], noEncontrados: [], revisar: [] }

  // -- 0. Plegar los ITEM repetidos sobre el que se conserva ------------------
  for (const [origen, destino] of Object.entries(FUSIONES).map(([o, d]) => [Number(o), d])) {
    const o = file.get(origen)
    if (!o) continue
    const d = file.get(destino)
    if (!d) throw new Error(`FUSION ${origen} -> ${destino}: el ITEM destino no esta en el archivo`)
    // El conteo del repetido vale solo si el destino no traia cantidad propia
    const aplicado = d.cantidad === null && o.cantidad !== null
    if (aplicado) d.cantidad = o.cantidad
    file.delete(origen)
    rep.fusionados.push({
      item_origen: origen, nombre_origen: o.nombre,
      item_destino: destino, nombre_destino: d.nombre,
      contado_origen: o.cantidad ?? '', contado_destino: d.cantidad ?? '',
      accion: aplicado
        ? `es el mismo insumo: el conteo se aplico al ITEM ${destino}`
        : `es el mismo insumo: el ITEM ${destino} ya traia su propio conteo`,
    })
    console.log(`   ITEM ${origen} "${o.nombre}" se pliega sobre el ${destino} "${d.nombre}"`)
  }

  try {
    await client.query('BEGIN')

    const db = (await client.query(
      `SELECT p.id, p.codigo, p.nombre_estandar, p.presentacion, p.activo,
              COALESCE(s.cantidad_real, 0) AS cantidad_real
         FROM productos p
         LEFT JOIN stock s ON s.producto_id = p.id`
    )).rows
    console.log(`Catalogo actual: ${db.length} productos (${db.filter(r => r.activo).length} activos)\n`)

    const porId  = new Map(db.map(r => [r.id, r]))
    const porCod = new Map(db.filter(r => r.codigo !== null).map(r => [Number(r.codigo), r]))

    // -- 2. Enlazar los ITEM que ya existian sin codigo ---------------------
    console.log('Enlazando items del archivo con productos existentes sin codigo...')
    for (const e of ENLACES) {
      const actual = porId.get(e.id)
      if (!actual) throw new Error(`ENLACE ITEM ${e.item}: no existe el producto ${e.id}`)
      if (norm(actual.nombre_estandar) !== norm(e.nombre))
        throw new Error(`ENLACE ITEM ${e.item}: el producto ${e.id} se llama "${actual.nombre_estandar}", se esperaba "${e.nombre}"`)
      // Idempotente: si ya se enlazo en una corrida anterior, no se repite
      const yaEnlazado = Number(actual.codigo) === e.item
      if (actual.codigo !== null && !yaEnlazado)
        throw new Error(`ENLACE ITEM ${e.item}: el producto ${e.id} ya tiene codigo ${actual.codigo}`)
      if (!yaEnlazado && porCod.has(e.item))
        throw new Error(`ENLACE ITEM ${e.item}: ese codigo ya lo usa otro producto`)

      if (!yaEnlazado) {
        if (!DRY) await client.query('UPDATE productos SET codigo = $2, updated_at = NOW() WHERE id = $1', [e.id, e.item])
        actual.codigo = e.item
        porCod.set(e.item, actual)
      }
      const f = file.get(e.item)
      rep.enlazados.push({
        item: e.item,
        producto: actual.nombre_estandar,
        presentacion: actual.presentacion ?? '',
        nombre_en_archivo: f?.nombre ?? '',
        stock_previo: Number(actual.cantidad_real),
        contado: f?.cantidad ?? '',
      })
    }
    console.log(`   ${rep.enlazados.length} enlazados\n`)

    // -- 3. Upsert de todo lo contado en el archivo -------------------------
    console.log('Cruzando productos contados...')
    const procesados = new Set() // ids que quedaron cubiertos por el inventario
    for (const [codigo, p] of file) {
      let actual = porCod.get(codigo)

      if (!actual) {
        // Producto nuevo: solo existe en el archivo
        let nuevoId = null
        if (!DRY) {
          const r = await client.query(
            `INSERT INTO productos (codigo, nombre_estandar, presentacion, tipo_insumo, cat_rotacion, activo)
             VALUES ($1, $2, $3, 'OTROS', 'C', true) RETURNING id`,
            [codigo, p.nombre, p.presentacion]
          )
          nuevoId = r.rows[0].id
        }
        actual = { id: nuevoId, codigo, nombre_estandar: p.nombre, presentacion: p.presentacion, activo: true, cantidad_real: 0 }
        porCod.set(codigo, actual)
        rep.nuevos.push({ item: codigo, producto: p.nombre, presentacion: p.presentacion ?? '', contado: p.cantidad ?? '' })
      } else {
        // Diferencias de texto: no se sobreescribe lo que ya tiene valor
        if (p.nombre && actual.nombre_estandar && norm(actual.nombre_estandar) !== norm(p.nombre))
          rep.revisar.push({ item: codigo, campo: 'nombre_estandar', en_bd: actual.nombre_estandar, en_archivo: p.nombre, accion: 'se conservo el valor de la BD' })
        if (p.presentacion && actual.presentacion && norm(actual.presentacion) !== norm(p.presentacion))
          rep.revisar.push({ item: codigo, campo: 'presentacion', en_bd: actual.presentacion, en_archivo: p.presentacion, accion: 'se conservo el valor de la BD' })

        const rellenaNombre = !actual.nombre_estandar && !!p.nombre
        const rellenaPres   = !actual.presentacion && !!p.presentacion
        if (!DRY) {
          await client.query(
            `UPDATE productos
                SET nombre_estandar = COALESCE(NULLIF($2, ''), nombre_estandar),
                    presentacion    = COALESCE(presentacion, $3),
                    activo          = true,
                    updated_at      = NOW()
              WHERE id = $1`,
            [actual.id, rellenaNombre ? p.nombre : '', p.presentacion]
          )
        }
        if (rellenaNombre) {
          actual.nombre_estandar = p.nombre
          rep.revisar.push({ item: codigo, campo: 'nombre_estandar', en_bd: '(vacio)', en_archivo: p.nombre, accion: 'se completo desde el archivo' })
        }
        if (rellenaPres) {
          actual.presentacion = p.presentacion
          rep.revisar.push({ item: codigo, campo: 'presentacion', en_bd: '(vacio)', en_archivo: p.presentacion, accion: 'se completo desde el archivo' })
        }
      }

      if (actual.id) procesados.add(actual.id)

      // Etiqueta: encontrado en este inventario
      if (!DRY) {
        await client.query(
          `UPDATE productos
              SET inventario_periodo = $2, inventario_encontrado = true, inventario_fecha = NOW()
            WHERE id = $1`,
          [actual.id, PERIODO]
        )
      }

      // Stock = lo contado. Si la celda CANTIDADES viene vacia, no se toca.
      if (p.cantidad === null) {
        rep.sinCantidad.push({
          item: codigo,
          producto: actual.nombre_estandar,
          stock_actual: Number(actual.cantidad_real),
          nota: 'celda CANTIDADES vacia en el archivo: el stock quedo sin cambios',
        })
      } else {
        const previo = Number(actual.cantidad_real)
        if (!DRY) {
          await client.query(
            `INSERT INTO stock (producto_id, cantidad_real, cantidad_disp) VALUES ($1, $2, $2)
             ON CONFLICT (producto_id) DO UPDATE
               SET cantidad_real = EXCLUDED.cantidad_real,
                   cantidad_disp = EXCLUDED.cantidad_disp,
                   updated_at    = NOW()`,
            [actual.id, p.cantidad]
          )
        }
        if (previo !== p.cantidad) {
          rep.actualizados.push({
            item: codigo,
            producto: actual.nombre_estandar,
            presentacion: actual.presentacion ?? '',
            stock_previo: previo,
            contado: p.cantidad,
            diferencia: p.cantidad - previo,
          })
        }
      }
    }
    console.log(`   ${file.size} items cruzados | ${rep.nuevos.length} nuevos | ${rep.actualizados.length} con cantidad distinta | ${rep.sinCantidad.length} sin cantidad\n`)

    // -- 4. Los que NO salieron en el inventario: se conservan + etiqueta ---
    console.log('Etiquetando los que no se encontraron en el inventario...')
    const ausentes = (await client.query(
      `SELECT p.id, p.codigo, p.nombre_estandar, p.presentacion, p.activo,
              COALESCE(s.cantidad_real, 0) AS cantidad_real
         FROM productos p
         LEFT JOIN stock s ON s.producto_id = p.id
        WHERE NOT (p.id = ANY($1::uuid[]))
        ORDER BY p.codigo NULLS LAST, p.nombre_estandar`,
      [[...procesados]]
    )).rows

    if (!DRY && ausentes.length) {
      await client.query(
        `UPDATE productos
            SET inventario_periodo = $2, inventario_encontrado = false, inventario_fecha = NOW()
          WHERE id = ANY($1::uuid[])`,
        [ausentes.map(r => r.id), PERIODO]
      )
    }
    for (const r of ausentes) {
      rep.noEncontrados.push({
        codigo: r.codigo ?? '(sin codigo)',
        producto: r.nombre_estandar,
        presentacion: r.presentacion ?? '',
        estado: r.activo ? 'activo' : 'inactivo',
        stock_conservado: Number(r.cantidad_real),
        etiqueta: `NO HALLADO - ${PERIODO}`,
      })
    }
    console.log(`   ${ausentes.length} etiquetados como "no hallado" (se conservan intactos)\n`)

    if (DRY) {
      await client.query('ROLLBACK')
      console.log('ROLLBACK (modo --dry)\n')
    } else {
      await client.query('COMMIT')
      console.log('Transaccion confirmada (COMMIT)\n')
    }
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('ROLLBACK por error:', e.message)
    await client.end()
    process.exit(1)
  }

  // -- 5. Reporte xlsx -------------------------------------------------------
  const wb = new ExcelJS.Workbook()
  const hoja = (nombre, filas) => {
    const ws = wb.addWorksheet(nombre)
    if (!filas.length) { ws.addRow(['(sin registros)']); return }
    const cols = Object.keys(filas[0])
    ws.columns = cols.map(c => ({ header: c.replace(/_/g, ' ').toUpperCase(), key: c, width: Math.min(48, Math.max(14, c.length + 8)) }))
    filas.forEach(f => ws.addRow(f))
    ws.getRow(1).font = { bold: true }
    ws.views = [{ state: 'frozen', ySplit: 1 }]
  }
  hoja('Cantidades actualizadas', rep.actualizados)
  hoja('No hallados', rep.noEncontrados)
  hoja('Productos nuevos', rep.nuevos)
  hoja('Enlazados sin duplicar', rep.enlazados)
  hoja('Fusionados', rep.fusionados)
  hoja('Sin cantidad', rep.sinCantidad)
  hoja('Revisar', rep.revisar)
  await wb.xlsx.writeFile(REPORTE)
  console.log(`Reporte: ${REPORTE}\n`)

  // -- 6. Resumen ------------------------------------------------------------
  const c = (await client.query(`
    SELECT (SELECT COUNT(*) FROM productos)                                              AS productos,
           (SELECT COUNT(*) FROM productos WHERE activo)                                 AS activos,
           (SELECT COUNT(*) FROM productos WHERE inventario_encontrado IS TRUE)          AS hallados,
           (SELECT COUNT(*) FROM productos WHERE inventario_encontrado IS FALSE)         AS no_hallados,
           (SELECT COALESCE(SUM(cantidad_real),0) FROM stock s
              JOIN productos p ON p.id = s.producto_id WHERE p.inventario_encontrado)    AS unidades_contadas
  `)).rows[0]

  const l = (k, v) => console.log(`|  ${k.padEnd(26)}${String(v).padEnd(14)}|`)
  console.log('+============================================+')
  console.log(`|   CRUCE INVENTARIO ${PERIODO.padEnd(24)}|`)
  console.log('+--------------------------------------------+')
  l('Cantidades cambiadas:', rep.actualizados.length)
  l('Productos nuevos:', rep.nuevos.length)
  l('Enlazados (sin dup.):', rep.enlazados.length)
  l('Items fusionados:', rep.fusionados.length)
  l('Sin cantidad:', rep.sinCantidad.length)
  l('Etiquetados NO HALLADO:', rep.noEncontrados.length)
  console.log('+--------------------------------------------+')
  l('Productos (total):', c.productos)
  l('Productos activos:', c.activos)
  l('Hallados en inventario:', c.hallados)
  l('No hallados:', c.no_hallados)
  l('Unidades contadas:', Math.round(c.unidades_contadas))
  console.log('+============================================+')

  await client.end()
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })

/**
 * Carga la FOTO del inventario fisico AGOSTO 2025 en `inventarios_fisicos` /
 * `inventario_fisico_items`, para que el modulo /inventario-fisico pueda
 * compararlo con los conteos siguientes.
 *
 *   node scripts/historico-inventario-agosto-2025.mjs --dry   (solo reporta)
 *   node scripts/historico-inventario-agosto-2025.mjs
 *
 * Ese cruce se aplico el 2026-08-24 (scripts/cruce-inventario-agosto-2025.mjs),
 * antes de que existiera el historial. NO toca stock ni productos: solo
 * reconstruye la foto con
 *   - el archivo original (cantidades contadas; 742 se pliega sobre 740 igual
 *     que en el cruce),
 *   - el reporte del cruce (docs/cruce-inventario-agosto-2025.xlsx) para el
 *     stock que tenia el sistema antes de aplicar,
 *   - la etiqueta inventario_periodo = 'AGOSTO 2025' / encontrado = false para
 *     los no hallados (solo los que estaban activos, como hace la funcion).
 *
 * Nota: el archivo de JULIO 2026 no es un conteo (no trae cantidades), por eso
 * no tiene foto.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PERIODO     = 'AGOSTO 2025'
const FECHA_CORTE = '2026-08-24'
const ARCHIVO     = 'C:/Users/maiko/Downloads/Concerjes/AGOSTO  2025.xlsx'
const REPORTE     = join(root, 'docs', 'cruce-inventario-agosto-2025.xlsx')
const FUSIONES    = { 742: 740 }
const DRY         = process.argv.includes('--dry')

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
const num  = v => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(/[,$\s]/g, '')))
const norm = v => (v ?? '').toString().normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toUpperCase()

async function hojas(path) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(path)
  return wb
}

/** Filas de una hoja del reporte como objetos (encabezados en MAYUSCULAS). */
function filas(ws) {
  if (!ws) return []
  const head = ws.getRow(1).values.slice(1).map(h => String(h ?? ''))
  const out = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values.slice(1)
    if (!vals.length) continue
    out.push(Object.fromEntries(head.map((h, i) => [h, cv({ value: vals[i] ?? null })])))
  }
  return out
}

function dbUrl() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
  if (!m) throw new Error('No se encontro DIRECT_URL en .env.local')
  return m[1].trim()
}

async function main() {
  // -- archivo original -------------------------------------------------------
  const ws = (await hojas(ARCHIVO)).getWorksheet('Hoja1')
  const file = new Map()
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const cod = num(cv(row.getCell(1)))
    const nombre = str(cv(row.getCell(2)))
    if (!cod || !nombre) continue
    file.set(cod, { nombre, presentacion: str(cv(row.getCell(3))), cantidad: num(cv(row.getCell(4))) })
  }
  for (const [o, d] of Object.entries(FUSIONES).map(([o, d]) => [Number(o), d])) {
    const a = file.get(o), b = file.get(d)
    if (a && b && b.cantidad === null) b.cantidad = a.cantidad
    file.delete(o)
  }

  // -- reporte del cruce ------------------------------------------------------
  const rep = await hojas(REPORTE)
  const previo = new Map()
  for (const f of filas(rep.getWorksheet('Cantidades actualizadas'))) previo.set(Number(f.ITEM), Number(f['STOCK PREVIO']))
  for (const f of filas(rep.getWorksheet('Enlazados sin duplicar')))   previo.set(Number(f.ITEM), Number(f['STOCK PREVIO']))
  for (const f of filas(rep.getWorksheet('Sin cantidad')))             previo.set(Number(f.ITEM), Number(f['STOCK ACTUAL']))
  const nuevos = new Set(filas(rep.getWorksheet('Productos nuevos')).map(f => Number(f.ITEM)))
  const ajustados = filas(rep.getWorksheet('Cantidades actualizadas')).length
  const noHallRep = filas(rep.getWorksheet('No hallados'))

  const client = new pg.Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  try {
    await client.query('BEGIN')
    if ((await client.query('SELECT 1 FROM inventarios_fisicos WHERE periodo = $1', [PERIODO])).rowCount)
      throw new Error(`Ya existe la foto de ${PERIODO}`)

    const db = (await client.query(
      `SELECT id, codigo, nombre_estandar, presentacion, activo, precio_lista,
              inventario_periodo, inventario_encontrado
         FROM productos`)).rows
    const porCod = new Map(db.filter(p => p.codigo !== null).map(p => [Number(p.codigo), p]))

    const items = []
    for (const [codigo, f] of file) {
      const p = porCod.get(codigo)
      if (!p) throw new Error(`ITEM ${codigo} del archivo no esta en la BD`)
      const stockSistema = nuevos.has(codigo) ? 0 : previo.has(codigo) ? previo.get(codigo) : f.cantidad
      items.push({
        producto_id: p.id, codigo, nombre: p.nombre_estandar, presentacion: p.presentacion,
        estado: f.cantidad === null ? 'SIN_CANTIDAD' : 'CONTADO',
        cantidad: f.cantidad, stock: stockSistema, precio: p.precio_lista, nuevo: nuevos.has(codigo),
      })
    }

    // No hallados de ese cruce que estaban activos (el reporte dice su estado y stock)
    const clave = (c, n, pr) => c !== null && c !== undefined && c !== '(sin codigo)' ? `c:${c}` : `n:${norm(n)}|${norm(pr)}`
    const repNo = new Map(noHallRep.map(f => [clave(f.CODIGO, f.PRODUCTO, f.PRESENTACION), f]))
    let sinMatch = 0
    for (const p of db.filter(p => p.inventario_periodo === PERIODO && p.inventario_encontrado === false)) {
      const f = repNo.get(clave(p.codigo, p.nombre_estandar, p.presentacion))
      if (!f) { sinMatch++; continue }
      if (f.ESTADO !== 'activo') continue
      items.push({
        producto_id: p.id, codigo: p.codigo, nombre: p.nombre_estandar, presentacion: p.presentacion,
        estado: 'NO_HALLADO', cantidad: null, stock: num(f['STOCK CONSERVADO']), precio: p.precio_lista, nuevo: false,
      })
    }

    const contados = items.filter(i => i.estado !== 'NO_HALLADO')
    const cab = {
      total: contados.length,
      conCant: contados.filter(i => i.estado === 'CONTADO').length,
      enCero: contados.filter(i => i.cantidad === 0).length,
      unidades: contados.reduce((s, i) => s + (i.cantidad ?? 0), 0),
      noHall: items.length - contados.length,
    }

    const inv = (await client.query(
      `INSERT INTO inventarios_fisicos
         (periodo, fecha_corte, archivo_nombre, observacion, historico, total_items, items_con_cantidad,
          items_en_cero, total_unidades, items_nuevos, items_ajustados, items_no_hallados)
       VALUES ($1, $2, $3, $4, true, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
      [PERIODO, FECHA_CORTE, 'AGOSTO  2025.xlsx',
       'Foto reconstruida despues del cruce (el stock ya se habia aplicado el 2026-08-24).',
       cab.total, cab.conCant, cab.enCero, cab.unidades, nuevos.size, ajustados, cab.noHall])).rows[0].id

    await client.query(
      `INSERT INTO inventario_fisico_items
         (inventario_id, producto_id, codigo, nombre, presentacion, estado,
          cantidad_contada, stock_sistema, precio_unitario, producto_nuevo)
       SELECT $1, x.producto_id, x.codigo, x.nombre, x.presentacion, x.estado,
              x.cantidad, x.stock, x.precio, x.nuevo
         FROM jsonb_to_recordset($2::jsonb) AS x(producto_id uuid, codigo int, nombre text, presentacion text,
              estado text, cantidad numeric, stock numeric, precio numeric, nuevo boolean)`,
      [inv, JSON.stringify(items)])

    console.log(`${PERIODO}: ${cab.total} contados (${cab.conCant} con cantidad, ${cab.enCero} en cero, ${cab.unidades} unidades), ` +
      `${cab.noHall} no hallados activos, ${nuevos.size} nuevos, ${ajustados} ajustados` +
      (sinMatch ? ` | ${sinMatch} no hallados sin fila en el reporte (omitidos)` : ''))

    await client.query(DRY ? 'ROLLBACK' : 'COMMIT')
    console.log(DRY ? 'ROLLBACK (modo --dry)' : 'COMMIT')
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('ROLLBACK por error:', e.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()

/**
 * Cruce del catalogo contra el inventario fisico SEPTIEMBRE 2026.
 *
 *   node scripts/cruce-inventario-septiembre-2026.mjs --dry   (solo reporta)
 *   node scripts/cruce-inventario-septiembre-2026.mjs         (aplica en BD)
 *
 * Fuente: DOC-20260927-WA0001.xlsx (llego por WhatsApp el 2026-09-27),
 *   hoja "Hoja1": ITEM | NOMBRE ESTANDAR | PRESENTACION | CANTIDADES
 *
 * Desde este periodo el cruce lo hace la funcion `aplicar_inventario_fisico`
 * (migracion 20260928000000_inventarios_fisicos.sql), la misma que usa la
 * pantalla /inventario-fisico. Este script solo lee el archivo, la llama
 * dentro de una transaccion y arma el reporte xlsx desde la foto guardada.
 * Reglas: ver el encabezado de la migracion.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PERIODO     = 'SEPTIEMBRE 2026'
const FECHA_CORTE = '2026-09-27'
const EXCEL_PATH  = 'C:/Users/maiko/Downloads/DOC-20260927-WA0001.xlsx'
const HOJA        = 'Hoja1'
const DRY         = process.argv.includes('--dry')
const REPORTE     = join(root, 'docs', DRY ? 'cruce-inventario-septiembre-2026-simulacro.xlsx'
                                           : 'cruce-inventario-septiembre-2026.xlsx')

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
const str = v => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim().replace(/\s+/g, ' '))
const num = v => {
  if (v === null || v === undefined || v === '') return null
  const n = parseFloat(String(v).replace(/[,$\s]/g, ''))
  return Number.isNaN(n) ? null : n
}
const norm = v => (v ?? '').toString().normalize('NFD').replace(/\p{M}/gu, '').trim().replace(/\s+/g, ' ').toUpperCase()

function dbUrl() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
  if (!m) throw new Error('No se encontro DIRECT_URL en .env.local')
  return m[1].trim()
}

async function leerExcel() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(EXCEL_PATH)
  const ws = wb.getWorksheet(HOJA)
  if (!ws) throw new Error(`No se encontro la hoja "${HOJA}"`)
  const items = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const codigo = num(cv(row.getCell(1)))
    const nombre = str(cv(row.getCell(2)))
    if (codigo === null || codigo < 1 || !nombre) continue
    items.push({ codigo, nombre, presentacion: str(cv(row.getCell(3))), cantidad: num(cv(row.getCell(4))) })
  }
  return items
}

async function main() {
  const items = await leerExcel()
  console.log(`Inventario ${PERIODO}: ${items.length} filas en el archivo`)

  const client = new pg.Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  let filas
  try {
    await client.query('BEGIN')
    // Sin sesion no hay auth.uid(): los AJUSTE quedan a nombre del primer SUPER_ADMIN
    const admin = (await client.query(
      `SELECT id FROM usuarios WHERE rol = 'SUPER_ADMIN' AND activo ORDER BY created_at LIMIT 1`)).rows[0]
    if (!admin) throw new Error('No hay un SUPER_ADMIN activo para firmar los ajustes')

    const inv = (await client.query(
      'SELECT aplicar_inventario_fisico($1, $2, $3, $4::jsonb, $5, $6) AS id',
      [PERIODO, FECHA_CORTE, 'DOC-20260927-WA0001.xlsx', JSON.stringify(items),
       'Conteo recibido por WhatsApp el 2026-09-27', admin.id])).rows[0].id

    filas = (await client.query(
      `SELECT i.*, p.nombre_estandar AS nombre_bd, p.presentacion AS presentacion_bd, p.activo
         FROM inventario_fisico_items i LEFT JOIN productos p ON p.id = i.producto_id
        WHERE i.inventario_id = $1 ORDER BY i.codigo NULLS LAST, i.nombre`, [inv])).rows
    const cab = (await client.query('SELECT * FROM inventarios_fisicos WHERE id = $1', [inv])).rows[0]

    // Comparacion con el conteo anterior (faltantes: estaban y ya no vienen)
    const ant = (await client.query(
      `SELECT i.producto_id, i.codigo, i.nombre, i.cantidad_contada
         FROM inventario_fisico_items i
        WHERE i.inventario_id = (SELECT id FROM inventarios_fisicos WHERE fecha_corte < $1
                                  ORDER BY fecha_corte DESC LIMIT 1)
          AND i.estado <> 'NO_HALLADO'`, [FECHA_CORTE])).rows
    const ahora = new Set(filas.filter(f => f.estado !== 'NO_HALLADO').map(f => f.producto_id))
    const faltantes = ant.filter(a => !ahora.has(a.producto_id))

    await client.query(DRY ? 'ROLLBACK' : 'COMMIT')
    console.log(DRY ? 'ROLLBACK (modo --dry: no se escribio nada)' : 'COMMIT')

    const n = x => (x === null || x === undefined ? '' : Number(x))
    const contados = filas.filter(f => f.estado !== 'NO_HALLADO')
    const wb = new ExcelJS.Workbook()
    const hoja = (nombre, rows) => {
      const ws = wb.addWorksheet(nombre)
      if (!rows.length) { ws.addRow(['(sin registros)']); return }
      const cols = Object.keys(rows[0])
      ws.columns = cols.map(c => ({ header: c.replace(/_/g, ' ').toUpperCase(), key: c, width: Math.min(50, Math.max(14, c.length + 8)) }))
      rows.forEach(r => ws.addRow(r))
      ws.getRow(1).font = { bold: true }
      ws.views = [{ state: 'frozen', ySplit: 1 }]
    }
    hoja('Cantidades ajustadas', contados.filter(f => f.estado === 'CONTADO' && Number(f.diferencia) !== 0).map(f => ({
      item: f.codigo, producto: f.nombre, presentacion: f.presentacion ?? '',
      stock_sistema: n(f.stock_sistema), contado: n(f.cantidad_contada), diferencia: n(f.diferencia),
    })))
    hoja('Faltantes vs anterior', faltantes.map(f => ({ item: f.codigo ?? '', producto: f.nombre, contado_anterior: n(f.cantidad_contada) })))
    hoja('No hallados (activos)', filas.filter(f => f.estado === 'NO_HALLADO').map(f => ({
      codigo: f.codigo ?? '(sin codigo)', producto: f.nombre, presentacion: f.presentacion ?? '', stock_conservado: n(f.stock_sistema),
    })))
    hoja('Productos nuevos', contados.filter(f => f.producto_nuevo).map(f => ({ item: f.codigo, producto: f.nombre, contado: n(f.cantidad_contada) })))
    hoja('Sin cantidad', contados.filter(f => f.estado === 'SIN_CANTIDAD').map(f => ({
      item: f.codigo, producto: f.nombre, stock_actual: n(f.stock_sistema), nota: 'celda vacia: el stock quedo sin cambios',
    })))
    const porCod = new Map(items.map(i => [i.codigo, i]))
    const revisar = []
    for (const f of contados) {
      const a = porCod.get(f.codigo)
      if (!a) continue
      if (norm(a.nombre) !== norm(f.nombre_bd)) revisar.push({ item: f.codigo, campo: 'nombre', en_bd: f.nombre_bd, en_archivo: a.nombre })
      if (a.presentacion && f.presentacion_bd && norm(a.presentacion) !== norm(f.presentacion_bd))
        revisar.push({ item: f.codigo, campo: 'presentacion', en_bd: f.presentacion_bd, en_archivo: a.presentacion })
    }
    hoja('Revisar', revisar.map(r => ({ ...r, accion: 'se conservo el valor de la BD' })))
    await wb.xlsx.writeFile(REPORTE)

    console.log(`
  Contados:            ${cab.total_items} (${cab.items_con_cantidad} con cantidad, ${cab.items_en_cero} en cero)
  Unidades contadas:   ${Number(cab.total_unidades)}
  Cantidades ajustadas:${String(cab.items_ajustados).padStart(4)}
  Productos nuevos:    ${cab.items_nuevos}
  No hallados activos: ${cab.items_no_hallados}
  Faltantes vs antes:  ${faltantes.length}
  Revisar:             ${revisar.length}
  Reporte: ${REPORTE}`)
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    console.error('ROLLBACK por error:', e.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}

main()

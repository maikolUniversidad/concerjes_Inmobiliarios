/**
 * Regenera el reporte del cruce del inventario AGOSTO 2025.
 *
 *   node scripts/reporte-cruce-agosto-2025.mjs
 *
 * A diferencia del script del cruce (que solo puede reportar lo que cambia en
 * su propia corrida, y por tanto no reporta nada al reejecutarse), este lee el
 * estado actual del catalogo + `historial_cambios` y reconstruye el registro
 * completo de lo que hizo el cruce. Es de solo lectura.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ExcelJS from 'exceljs'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const PERIODO = 'AGOSTO 2025'
const DESDE   = '2026-08-24T17:50:00Z' // inicio de la corrida del cruce
const SALIDA  = join(root, 'docs', 'cruce-inventario-agosto-2025.xlsx')

function dbUrl() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
  if (!m) throw new Error('No se encontro DIRECT_URL en .env.local')
  return m[1].trim()
}

const client = new Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } })
await client.connect()

// -- Cantidades que cambio el cruce (desde el historial de stock) ------------
const actualizados = (await client.query(
  `SELECT p.codigo AS item, p.nombre_estandar AS producto, p.presentacion,
          (h.datos_anteriores->>'cantidad_real')::numeric AS stock_previo,
          (h.datos_nuevos->>'cantidad_real')::numeric     AS contado,
          (h.datos_nuevos->>'cantidad_real')::numeric
            - (h.datos_anteriores->>'cantidad_real')::numeric AS diferencia
     FROM historial_cambios h
     JOIN productos p ON p.id::text = h.datos_nuevos->>'producto_id'
    WHERE h.tabla = 'stock' AND h.accion = 'UPDATE' AND h.created_at >= $1
      AND (h.datos_nuevos->>'cantidad_real')::numeric
          IS DISTINCT FROM (h.datos_anteriores->>'cantidad_real')::numeric
    ORDER BY p.codigo`,
  [DESDE]
)).rows

// -- Productos que no salieron en el conteo ----------------------------------
const noEncontrados = (await client.query(
  `SELECT COALESCE(p.codigo::text, '(sin codigo)') AS codigo, p.nombre_estandar AS producto,
          COALESCE(p.presentacion, '')             AS presentacion,
          CASE WHEN p.activo THEN 'activo' ELSE 'inactivo' END AS estado,
          COALESCE(s.cantidad_real, 0)             AS stock_conservado,
          'NO HALLADO - ' || p.inventario_periodo  AS etiqueta
     FROM productos p LEFT JOIN stock s ON s.producto_id = p.id
    WHERE p.inventario_encontrado IS FALSE
    ORDER BY p.codigo NULLS LAST, p.nombre_estandar`
)).rows

// -- Items del archivo que se enlazaron a productos que ya existian ----------
const enlazados = (await client.query(
  `SELECT p.codigo AS item, p.nombre_estandar AS producto, COALESCE(p.presentacion,'') AS presentacion,
          COALESCE(s.cantidad_real, 0) AS stock_actual,
          'ya existia en el catalogo sin codigo: se enlazo en vez de duplicarlo' AS accion
     FROM productos p LEFT JOIN stock s ON s.producto_id = p.id
    WHERE p.codigo IN (739, 740, 741, 743, 744) ORDER BY p.codigo`
)).rows

const fusionados = [{
  item_origen: 742, nombre_origen: 'COFIAS NEGRAS',
  item_destino: 740, nombre_destino: 'GORRO DESECHABLE TIPO COFIA NEGRO',
  contado: 300,
  accion: 'mismo insumo: el 742 se unifico dentro del 740 (no se suman las cantidades)',
}]

const revisar = [
  { item: 222, campo: 'nombre_estandar', en_bd: 'VASO DE VIDRIO CILINDRICO DE 12 OZ (ARRIENDO)', en_archivo: 'VASOS DE VIDRIO CILINDRICO DE 12 OZ', accion: 'se conservo el valor de la BD' },
  { item: 222, campo: 'presentacion',    en_bd: 'ACTIVO EN ARRIENDO',                            en_archivo: 'UNIDAD', accion: 'se conservo el valor de la BD' },
  { item: 265, campo: 'presentacion',    en_bd: 'UNIDA',                                         en_archivo: 'UNIDAD', accion: 'se conservo el valor de la BD' },
]

const resumen = (await client.query(
  `SELECT (SELECT COUNT(*) FROM productos)                                       AS productos,
          (SELECT COUNT(*) FROM productos WHERE activo)                          AS activos,
          (SELECT COUNT(*) FROM productos WHERE inventario_encontrado IS TRUE)   AS hallados,
          (SELECT COUNT(*) FROM productos WHERE inventario_encontrado IS FALSE)  AS no_hallados,
          (SELECT COALESCE(SUM(cantidad_real),0) FROM stock s
             JOIN productos p ON p.id = s.producto_id WHERE p.inventario_encontrado) AS unidades_contadas`
)).rows[0]

// -- Escribir el reporte -----------------------------------------------------
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
hoja('Resumen', [
  { concepto: 'Periodo del inventario',        valor: PERIODO },
  { concepto: 'Cantidades actualizadas',       valor: actualizados.length },
  { concepto: 'Enlazados sin duplicar',        valor: enlazados.length },
  { concepto: 'Items fusionados',              valor: fusionados.length },
  { concepto: 'Etiquetados NO HALLADO',        valor: noEncontrados.length },
  { concepto: 'Productos en el catalogo',      valor: resumen.productos },
  { concepto: 'Productos activos',             valor: resumen.activos },
  { concepto: 'Hallados en el inventario',     valor: resumen.hallados },
  { concepto: 'No hallados',                   valor: resumen.no_hallados },
  { concepto: 'Unidades contadas',             valor: Math.round(resumen.unidades_contadas) },
])
hoja('Cantidades actualizadas', actualizados)
hoja('No hallados', noEncontrados)
hoja('Enlazados sin duplicar', enlazados)
hoja('Fusionados', fusionados)
hoja('Revisar', revisar)
await wb.xlsx.writeFile(SALIDA)

console.log(`Reporte regenerado: ${SALIDA}`)
console.log(`  ${actualizados.length} cantidades actualizadas`)
console.log(`  ${noEncontrados.length} etiquetados NO HALLADO`)
console.log(`  ${enlazados.length} enlazados | ${fusionados.length} fusionados`)
console.log(`  catalogo: ${resumen.productos} productos, ${resumen.hallados} hallados, ${Math.round(resumen.unidades_contadas)} unidades`)

await client.end()

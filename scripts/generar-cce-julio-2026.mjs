/**
 * Genera la migracion de REPARAMETRIZACION de Colombia Compra Eficiente (CCE)
 * a partir de "INVENTARIO JULIO 2026 COLOMBIA COMPRA.xlsx" (hoja "Hoja1").
 *
 *   node scripts/generar-cce-julio-2026.mjs [ruta-del-xlsx]
 *
 * Estructura de la hoja (por fila, una fila = un producto y/o un bien CCE):
 *   col 1  ITEM                 -> productos.codigo
 *   col 2  NOMBRE ESTANDAR      -> nombre del producto (referencia, no se toca)
 *   col 3  PRESENTACION         -> presentacion del producto (referencia, no se toca)
 *   col 5  #                    -> numero de item del catalogo CCE  (= productos.codigo)
 *   col 6  BIEN                 -> nombre oficial del bien CCE
 *   col 7  ESPECIFICACION TECNICA
 *   col 10 presentacion CCE
 *
 * El numero de item es la clave del catalogo: los nombres de bien se repiten
 * (p. ej. "Panela pulverizada" aparece 6 veces con especificaciones distintas).
 *
 * Salida: supabase/migrations/20260826000000_cce_reparametrizacion.sql
 */
import ExcelJS from 'exceljs'
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXCEL_PATH = process.argv[2]
  ?? 'C:/Users/maiko/Downloads/Concerjes/INVENTARIO JULIO 2026 COLOMBIA COMPRA.xlsx'
const OUT = join(root, 'supabase/migrations/20260826000000_cce_reparametrizacion.sql')

const cv = cell => {
  let v = cell ? cell.value : null
  if (v && typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('')
    v = v.text ?? v.result ?? ''
  }
  return v === null || v === undefined ? '' : String(v).trim().replace(/[ \t]+/g, ' ')
}
const q = v => (v === null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)

const wb = new ExcelJS.Workbook()
await wb.xlsx.readFile(EXCEL_PATH)
const ws = wb.getWorksheet('Hoja1')
if (!ws) throw new Error('No se encontro la hoja "Hoja1"')

const bienes = new Map() // item -> { bien, especificacion, presentacion }
for (let r = 2; r <= ws.rowCount; r++) {
  const row = ws.getRow(r)
  const item = Number(cv(row.getCell(5)))
  const bien = cv(row.getCell(6))
  if (!Number.isFinite(item) || item < 1 || !bien) continue
  if (bienes.has(item)) throw new Error(`Item CCE duplicado en la fila ${r}: ${item}`)
  bienes.set(item, {
    bien,
    especificacion: cv(row.getCell(7)) || null,
    presentacion: cv(row.getCell(10)) || null,
  })
}
const items = [...bienes.keys()].sort((a, b) => a - b)
console.log(`📋 ${items.length} bienes CCE leidos (item ${items[0]}..${items[items.length - 1]})`)

const values = items
  .map(i => {
    const b = bienes.get(i)
    return `  (${i}, ${q(b.bien)}, ${q(b.especificacion)}, ${q(b.presentacion)})`
  })
  .join(',\n')

const sql = `-- Colombia Compra Eficiente — REPARAMETRIZACION
-- Fuente: "INVENTARIO JULIO 2026 COLOMBIA COMPRA.xlsx" (hoja "Hoja1")
-- Generado por: scripts/generar-cce-julio-2026.mjs
--
-- Reemplaza POR COMPLETO la parametrizacion anterior (catalogo de 418 bienes +
-- auto-emparejamiento por similitud de nombre de 20260814000000) por la relacion
-- oficial del archivo: ${items.length} bienes numerados que se enlazan a los productos
-- por numero de item  ->  productos.codigo = colombia_compra_eficiente.item
--
-- Idempotente: puede re-aplicarse sin romper nada.

-- ─── 1. ESTRUCTURA ──────────────────────────────────────────────────────────
-- El item numerico pasa a ser la clave del catalogo: los nombres de bien se
-- repiten (p. ej. "Panela pulverizada" son 6 bienes con especificaciones
-- distintas), asi que el indice unico sobre "bien" deja de ser valido.
ALTER TABLE colombia_compra_eficiente ADD COLUMN IF NOT EXISTS item INTEGER;
DROP INDEX IF EXISTS uq_cce_bien;

-- El archivo nuevo no trae cantidad mensual ni precio piso.
ALTER TABLE colombia_compra_eficiente DROP COLUMN IF EXISTS cantidad_mensual;
ALTER TABLE colombia_compra_eficiente DROP COLUMN IF EXISTS precio_piso;

-- ─── 2. ELIMINAR LA PARAMETRIZACION ANTERIOR ────────────────────────────────
UPDATE productos SET cce_bien_id = NULL WHERE cce_bien_id IS NOT NULL;
DELETE FROM colombia_compra_eficiente;

-- ─── 3. CATALOGO NUEVO (${items.length} bienes) ──────────────────────────────────────────
INSERT INTO colombia_compra_eficiente (item, bien, especificacion, presentacion)
VALUES
${values};

CREATE UNIQUE INDEX IF NOT EXISTS uq_cce_item ON colombia_compra_eficiente (item);
ALTER TABLE colombia_compra_eficiente ALTER COLUMN item SET NOT NULL;

-- ─── 4. RELACION CON PRODUCTOS (por codigo) ─────────────────────────────────
UPDATE productos p
SET cce_bien_id = c.id
FROM colombia_compra_eficiente c
WHERE p.codigo = c.item;
`

writeFileSync(OUT, sql, 'utf8')
console.log(`✅ ${OUT}`)
console.log(`   ${(sql.length / 1024).toFixed(1)} KB`)

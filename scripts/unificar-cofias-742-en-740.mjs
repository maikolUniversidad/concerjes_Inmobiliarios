/**
 * Unifica el producto duplicado ITEM 742 "COFIAS NEGRAS" dentro del
 * ITEM 740 "GORRO DESECHABLE TIPO COFIA NEGRO" (son el mismo insumo).
 *
 *   node scripts/unificar-cofias-742-en-740.mjs --dry     (solo reporta)
 *   node scripts/unificar-cofias-742-en-740.mjs           (aplica en BD)
 *
 * Contexto: el cruce del inventario AGOSTO 2025 traia el mismo insumo en dos
 * filas — el 740 sin cantidad (celda vacia) y el 742 con 300 unidades. El 742
 * se creo como producto nuevo y quedo duplicando las 300 unidades del 740.
 *
 * Que hace:
 *   - Verifica que el 742 no tenga historia propia (movimientos, ordenes,
 *     pedidos, OC, fotos, etc.). Si la tuviera, aborta: habria que migrarla.
 *   - Deja el stock del 740 en las 300 unidades contadas (es el mismo conteo,
 *     no se suman: serian 300 unidades fantasma).
 *   - Anota en `complemento` del 740 que "COFIAS NEGRAS" es el mismo insumo.
 *   - Elimina el 742. El trigger `registrar_historial()` guarda el DELETE en
 *     `historial_cambios`, asi que la operacion queda auditada y es reversible.
 *
 * Todo corre dentro de una unica transaccion.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const ORIGEN  = 742 // COFIAS NEGRAS — se elimina
const DESTINO = 740 // GORRO DESECHABLE TIPO COFIA NEGRO — se conserva
const NOMBRE_ORIGEN  = 'COFIAS NEGRAS'
const NOMBRE_DESTINO = 'GORRO DESECHABLE TIPO COFIA NEGRO'
const NOTA = 'Tambien llamado COFIAS NEGRAS (unificado del ITEM 742 en el inventario AGOSTO 2025).'
const DRY = process.argv.includes('--dry')

function dbUrl() {
  const env = readFileSync(join(root, '.env.local'), 'utf8')
  const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
  if (!m) throw new Error('No se encontro DIRECT_URL en .env.local')
  return m[1].trim()
}

async function main() {
  const client = new Client({ connectionString: dbUrl(), ssl: { rejectUnauthorized: false } })
  await client.connect()
  console.log(`Conectado a Supabase${DRY ? '  (modo --dry: no se escribe nada)' : ''}\n`)

  try {
    await client.query('BEGIN')

    const prods = (await client.query(
      `SELECT p.id, p.codigo, p.nombre_estandar, p.presentacion, p.complemento, p.sku,
              COALESCE(s.cantidad_real, 0) AS cantidad_real
         FROM productos p
         LEFT JOIN stock s ON s.producto_id = p.id
        WHERE p.codigo = ANY($1::int[])`,
      [[ORIGEN, DESTINO]]
    )).rows
    const origen  = prods.find(r => Number(r.codigo) === ORIGEN)
    const destino = prods.find(r => Number(r.codigo) === DESTINO)

    if (!destino) throw new Error(`No existe el producto destino (codigo ${DESTINO})`)
    if (!origen) {
      console.log(`El producto ${ORIGEN} ya no existe: la unificacion ya se aplico. Nada que hacer.`)
      await client.query('ROLLBACK')
      await client.end()
      return
    }
    if (origen.nombre_estandar !== NOMBRE_ORIGEN)
      throw new Error(`El codigo ${ORIGEN} se llama "${origen.nombre_estandar}", se esperaba "${NOMBRE_ORIGEN}"`)
    if (destino.nombre_estandar !== NOMBRE_DESTINO)
      throw new Error(`El codigo ${DESTINO} se llama "${destino.nombre_estandar}", se esperaba "${NOMBRE_DESTINO}"`)

    console.log(`Origen  ${ORIGEN}: "${origen.nombre_estandar}"  stock ${origen.cantidad_real}`)
    console.log(`Destino ${DESTINO}: "${destino.nombre_estandar}"  stock ${destino.cantidad_real}  sku ${destino.sku ?? '-'}\n`)

    // -- Guarda: el origen no puede tener historia propia --------------------
    const fks = (await client.query(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu   ON kcu.constraint_name = tc.constraint_name
         JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'productos' AND ccu.column_name = 'id'
        ORDER BY 1`
    )).rows

    const bloqueantes = []
    for (const f of fks) {
      if (f.table_name === 'stock') continue // se elimina explicitamente mas abajo
      const n = (await client.query(
        `SELECT COUNT(*)::int AS n FROM ${f.table_name} WHERE ${f.column_name} = $1`, [origen.id]
      )).rows[0].n
      if (n > 0) bloqueantes.push(`${f.table_name}.${f.column_name} (${n})`)
    }
    if (bloqueantes.length)
      throw new Error(`El producto ${ORIGEN} tiene registros asociados: ${bloqueantes.join(', ')}. Migralos al ${DESTINO} antes de unificar.`)
    console.log(`Verificado: el ${ORIGEN} no tiene movimientos, ordenes ni pedidos asociados.\n`)

    // -- Stock del destino: las 300 unidades contadas, NO la suma ------------
    const contado = Number(origen.cantidad_real)
    const previo  = Number(destino.cantidad_real)
    if (!DRY) {
      await client.query(
        `INSERT INTO stock (producto_id, cantidad_real, cantidad_disp) VALUES ($1, $2, $2)
         ON CONFLICT (producto_id) DO UPDATE
           SET cantidad_real = EXCLUDED.cantidad_real,
               cantidad_disp = EXCLUDED.cantidad_disp,
               updated_at    = NOW()`,
        [destino.id, contado]
      )
      await client.query(
        `UPDATE productos
            SET complemento = CASE
                  WHEN complemento IS NULL OR complemento = '' THEN $2
                  WHEN position($2 in complemento) > 0          THEN complemento
                  ELSE complemento || ' ' || $2 END,
                presentacion = COALESCE(presentacion, $3),
                activo       = true,
                updated_at   = NOW()
          WHERE id = $1`,
        [destino.id, NOTA, origen.presentacion]
      )
    }
    console.log(`Stock del ${DESTINO}: ${previo} -> ${contado} (conteo unico del inventario, no se suman)`)

    // -- Eliminar el duplicado ----------------------------------------------
    // El FK stock.producto_id no tiene ON DELETE CASCADE en la BD desplegada,
    // asi que la fila de stock se borra explicitamente antes del producto.
    if (!DRY) {
      await client.query('DELETE FROM stock WHERE producto_id = $1', [origen.id])
      await client.query('DELETE FROM productos WHERE id = $1', [origen.id])
    }
    console.log(`Producto ${ORIGEN} "${NOMBRE_ORIGEN}" eliminado (queda registrado en historial_cambios)\n`)

    if (DRY) { await client.query('ROLLBACK'); console.log('ROLLBACK (modo --dry)\n') }
    else     { await client.query('COMMIT');   console.log('Transaccion confirmada (COMMIT)\n') }
  } catch (e) {
    await client.query('ROLLBACK')
    console.error('ROLLBACK por error:', e.message)
    await client.end()
    process.exit(1)
  }

  const r = (await client.query(
    `SELECT p.codigo, p.nombre_estandar, p.presentacion, p.complemento, p.sku, s.cantidad_real
       FROM productos p LEFT JOIN stock s ON s.producto_id = p.id
      WHERE p.codigo = ANY($1::int[]) ORDER BY p.codigo`,
    [[ORIGEN, DESTINO]]
  )).rows
  console.log('Estado final:')
  console.table(r)

  await client.end()
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1) })

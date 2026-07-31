/**
 * Actualiza el inventario en Supabase con el archivo DEFINITIVO de Julio 2026.
 *   node scripts/update-inventario-julio-2026.mjs
 *
 * Fuente: INVENTARIO JULIO 2026.xlsx (hoja "Hoja1")
 *   Columnas: ITEM | NOMBRE ESTANDAR | PRESENTACION | CANTIDADES
 *
 * Reglas de reconciliacion:
 *   - Producto que YA existe (por codigo)  -> actualiza nombre, presentacion,
 *     stock (cantidad_real = cantidad_disp = CANTIDADES) y lo deja activo=true.
 *   - Producto NUEVO (solo en archivo)      -> inserta producto (tipo OTROS,
 *     cat C, activo=true) + su registro de stock.
 *   - Producto que esta en BD pero NO en el archivo definitivo -> activo=false
 *     y stock (real/disp) = 0. Se conserva en la BD (reversible).
 *
 * Todo corre dentro de una unica transaccion.
 */
import ExcelJS from 'exceljs';
import pg from 'pg';

const { Client } = pg;
const EXCEL_PATH = 'C:/Users/MAIKOL/Downloads/INVENTARIO JULIO 2026.xlsx';
const DB_URL = 'postgresql://postgres.esehmwmtevwrqxvbzmev:S9qxOMoOZCepMyke@aws-1-us-west-2.pooler.supabase.com:5432/postgres';

const cv = cell => {
  const v = cell ? cell.value : null;
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
    if (v.text !== undefined) return v.text;
    if (v.result !== undefined) return v.result;
    return null;
  }
  return v;
};
const str = v => (v ? String(v).trim().replace(/\s+/g, ' ').toUpperCase() : null);
const num = v => {
  if (v === null || v === undefined || v === '') return 0;
  const n = parseFloat(String(v).replace(/[,$\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

async function main() {
  // ── 1. Leer archivo definitivo ────────────────────────────────────────────
  console.log('📂 Leyendo INVENTARIO JULIO 2026.xlsx ...');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);
  const ws = wb.getWorksheet('Hoja1');
  if (!ws) throw new Error('No se encontro la hoja "Hoja1"');

  const file = new Map(); // codigo -> { nombre, presentacion, cantidad }
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const codigo = cv(row.getCell(1));
    const nombre = str(cv(row.getCell(2)));
    if (codigo === null || codigo === undefined || !nombre) continue;
    const cod = Number(codigo);
    if (!Number.isFinite(cod) || cod < 1) continue;
    file.set(cod, {
      nombre,
      presentacion: str(cv(row.getCell(3))),
      cantidad: num(cv(row.getCell(4))),
    });
  }
  console.log(`   ${file.size} productos en el archivo definitivo\n`);

  // ── 2. Conectar ────────────────────────────────────────────────────────────
  const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('✅ Conectado a Supabase\n');

  const stats = { actualizados: 0, insertados: 0, desactivados: 0, stockUpsert: 0 };

  try {
    await client.query('BEGIN');

    // Mapa codigo -> id de lo que ya existe
    const existing = new Map();
    const q = await client.query('SELECT id, codigo FROM productos WHERE codigo IS NOT NULL');
    for (const row of q.rows) existing.set(Number(row.codigo), row.id);

    // ── 3. Upsert de los productos del archivo ──────────────────────────────
    console.log('📦 Actualizando / insertando productos del archivo...');
    for (const [codigo, p] of file) {
      let prodId = existing.get(codigo);

      if (prodId) {
        await client.query(
          `UPDATE productos
             SET nombre_estandar = $2,
                 presentacion    = $3,
                 activo          = true,
                 updated_at      = NOW()
           WHERE id = $1`,
          [prodId, p.nombre, p.presentacion]
        );
        stats.actualizados++;
      } else {
        const r = await client.query(
          `INSERT INTO productos
             (codigo, nombre_estandar, presentacion, tipo_insumo, cat_rotacion, activo)
           VALUES ($1, $2, $3, 'OTROS', 'C', true)
           RETURNING id`,
          [codigo, p.nombre, p.presentacion]
        );
        prodId = r.rows[0].id;
        existing.set(codigo, prodId);
        stats.insertados++;
      }

      // Stock: cantidad_real = cantidad_disp = CANTIDADES del archivo
      await client.query(
        `INSERT INTO stock (producto_id, cantidad_real, cantidad_disp)
           VALUES ($1, $2, $2)
         ON CONFLICT (producto_id) DO UPDATE
           SET cantidad_real = EXCLUDED.cantidad_real,
               cantidad_disp = EXCLUDED.cantidad_disp,
               updated_at    = NOW()`,
        [prodId, p.cantidad]
      );
      stats.stockUpsert++;
    }
    console.log(`   ✅ ${stats.actualizados} actualizados, ${stats.insertados} insertados\n`);

    // ── 4. Productos en BD que NO estan en el archivo -> desactivar + stock 0 ─
    console.log('🚫 Desactivando productos ausentes del archivo definitivo...');
    const fileCodes = [...file.keys()];
    const off = await client.query(
      `UPDATE productos
         SET activo = false, updated_at = NOW()
       WHERE codigo IS NOT NULL
         AND NOT (codigo = ANY($1::int[]))
         AND activo = true
       RETURNING id`,
      [fileCodes]
    );
    stats.desactivados = off.rowCount;

    await client.query(
      `UPDATE stock s
         SET cantidad_real = 0, cantidad_disp = 0, updated_at = NOW()
       FROM productos p
       WHERE s.producto_id = p.id
         AND p.codigo IS NOT NULL
         AND NOT (p.codigo = ANY($1::int[]))
         AND (s.cantidad_real <> 0 OR s.cantidad_disp <> 0)`,
      [fileCodes]
    );
    console.log(`   ✅ ${stats.desactivados} productos desactivados (stock a 0)\n`);

    await client.query('COMMIT');
    console.log('💾 Transaccion confirmada (COMMIT)\n');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ ROLLBACK por error:', e.message);
    await client.end();
    process.exit(1);
  }

  // ── 5. Resumen final ────────────────────────────────────────────────────────
  const c = (
    await client.query(`
      SELECT
        (SELECT COUNT(*) FROM productos)                       AS productos,
        (SELECT COUNT(*) FROM productos WHERE activo)          AS activos,
        (SELECT COUNT(*) FROM productos WHERE NOT activo)      AS inactivos,
        (SELECT COUNT(*) FROM stock)                           AS stock_rows,
        (SELECT COALESCE(SUM(cantidad_real),0) FROM stock s
           JOIN productos p ON p.id=s.producto_id WHERE p.activo) AS unidades_activas
    `)
  ).rows[0];

  console.log('╔════════════════════════════════════════════╗');
  console.log('║   ✅ INVENTARIO JULIO 2026 ACTUALIZADO       ║');
  console.log('╠════════════════════════════════════════════╣');
  console.log(`║  Actualizados:        ${String(stats.actualizados).padEnd(21)}║`);
  console.log(`║  Insertados (nuevos): ${String(stats.insertados).padEnd(21)}║`);
  console.log(`║  Desactivados:        ${String(stats.desactivados).padEnd(21)}║`);
  console.log('╟────────────────────────────────────────────╢');
  console.log(`║  Productos (total):   ${String(c.productos).padEnd(21)}║`);
  console.log(`║  Productos activos:   ${String(c.activos).padEnd(21)}║`);
  console.log(`║  Productos inactivos: ${String(c.inactivos).padEnd(21)}║`);
  console.log(`║  Unidades (activas):  ${String(Math.round(c.unidades_activas)).padEnd(21)}║`);
  console.log('╚════════════════════════════════════════════╝');

  await client.end();
}

main().catch(e => {
  console.error('\nFATAL:', e.message);
  process.exit(1);
});

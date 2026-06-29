/**
 * Carga datos reales desde CMI Reabastecimiento JUNIO V1.xlsb a Supabase
 * node scripts/load-excel-data.mjs
 */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
import pg from 'pg';

const { Client } = pg;
const EXCEL_PATH = 'C:/Users/maiko/Downloads/CMI Reabastecimiento JUNIO V1 (1).xlsb';
const DB_URL = 'postgresql://postgres.esehmwmtevwrqxvbzmev:S9qxOMoOZCepMyke@aws-1-us-west-2.pooler.supabase.com:5432/postgres';

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } });

const num = v => {
  if (v === null || v === undefined || v === '' || v === '#') return null;
  const n = parseFloat(String(v).replace(/[,$\s]/g,''));
  return isNaN(n) ? null : n;
};
const str  = v => v ? String(v).trim().replace(/\s+/g,' ').toUpperCase() : null;
const clean = v => v ? String(v).trim() : null;

function mapTipo(t) {
  if (!t) return 'OTROS';
  const u = String(t).toUpperCase();
  if (u.includes('CAFE') || u.includes('CAFET')) return 'CAFETERIA';
  if (u.includes('LIQUID')) return 'LIQUIDOS';
  if (u.includes('ASEO')) return 'ASEO';
  if (u.includes('EPP')) return 'EPP';
  if (u.includes('PAPEL')) return 'PAPELERIA';
  if (u.includes('MAQUIN')) return 'MAQUINARIA';
  if (u.includes('JARDIN')) return 'JARDINERIA';
  if (u.includes('REPUES')) return 'REPUESTOS';
  if (u.includes('NO DISP') || u.includes('NO_DISP') || u.includes('NO DISPONIBLE')) return 'NO_DISPONIBLE';
  if (u.includes('VARIOS') || u.includes('VARIOS')) return 'OTROS';
  return 'OTROS';
}
function mapCat(c) {
  const u = String(c||'').trim().toUpperCase();
  return ['A','B','C','D'].includes(u) ? u : 'C';
}

// Separar nombre y presentación: el texto puede ser "NOMBRE PRESENTACION"
// En Stock col1 viene concatenado — intentamos separarlos con Matriz Neg como fuente canónica
function parsePresentacion(desc) {
  if (!desc) return { nombre: '', presentacion: null };
  const d = String(desc).trim().toUpperCase();
  // Patterns comunes de presentación al final
  const patterns = [
    /\s+(GALON|LITRO|KG|GR|ML|UN|UND|UNIDAD|PAQUETE[^$]*|TARRO[^$]*|BOLSA[^$]*|CAJA[^$]*|ROLLO[^$]*|PAR[^$]*|METRO[^$]*|JUEGO[^$]*|KIT[^$]*|GARRAFA[^$]*|BALDE[^$]*|CANECA[^$]*|BULTO[^$]*|CARTON[^$]*)$/i
  ];
  for (const p of patterns) {
    const m = d.match(p);
    if (m) return { nombre: d.replace(p,'').trim(), presentacion: m[1].trim() };
  }
  return { nombre: d, presentacion: null };
}

async function main() {
  console.log('📂 Leyendo Excel...');
  const wb = XLSX.readFile(EXCEL_PATH, {});
  console.log('   Hojas disponibles:', wb.SheetNames.join(', '));

  await client.connect();
  console.log('✅ Conectado a Supabase\n');

  // ── 1. Limpiar ──────────────────────────────────────────────────────────────
  console.log('🗑️  Limpiando datos existentes...');
  await client.query(`
    TRUNCATE TABLE rotacion, aprovisionamiento, pedidos_sede, movimientos,
      oc_items, ordenes_compra, stock, sedes, grupos_contrato,
      precios_proveedor, productos, proveedores
    RESTART IDENTITY CASCADE;
  `);
  console.log('   OK\n');

  // ── 2. Proveedores ─────────────────────────────────────────────────────────
  console.log('🏭 Proveedores...');
  const provNombres = [
    ['CAFE VISION 2026', true], ['COIN', true], ['SCOPA', true],
    ['DETALGRAF', true], ['ENVASE NATURAL 2026', true], ['DIST. RODRIGUEZ 2026', true],
    ['ONFLY 2026', true], ['MONTERREY', false], ['BEAUTE', false],
    ['SUMICORP', false], ['CAJA MENOR', false],
  ];
  const provMap = {};
  for (const [nombre, esPrincipal] of provNombres) {
    const r = await client.query(
      `INSERT INTO proveedores (nombre, es_principal) VALUES ($1,$2) RETURNING id`,
      [nombre, esPrincipal]
    );
    provMap[nombre.toUpperCase()] = r.rows[0].id;
  }
  console.log(`   ✅ ${Object.keys(provMap).length} proveedores\n`);

  // ── 3. Grupos ───────────────────────────────────────────────────────────────
  console.log('🏢 Grupos de contrato...');
  const gruposData = [
    ['CA','Corferias / Bibliotecas / Colegios / Amazonia'],
    ['MO','Ministerios / Alcaldías / Entidades Estado'],
    ['MB','Comerbas / Santorini / Fuerza Aérea'],
    ['PB','UNAD — Nacional'],
    ['AD','Administraciones / Copropiedades'],
  ];
  const grupoMap = {};
  for (const [codigo, nombre] of gruposData) {
    const r = await client.query(
      `INSERT INTO grupos_contrato (codigo, nombre) VALUES ($1,$2) ON CONFLICT (codigo) DO UPDATE SET nombre=EXCLUDED.nombre RETURNING id`,
      [codigo, nombre]
    );
    grupoMap[codigo] = r.rows[0].id;
  }
  console.log(`   ✅ ${Object.keys(grupoMap).length} grupos\n`);

  // ── 4. Sedes desde hojas de distribución ───────────────────────────────────
  console.log('📍 Sedes...');

  // Estructura headers de cada hoja
  // M.O.: Row 2 (index 2), sedes desde col 5
  // C.A.: Row 2 (index 2), sedes desde col 5
  // M.B.: Row 0 o 1?, verificar
  // P.B.: sedes desde col 5
  const sedeSheets = [
    { sheet: 'M.O.', grupo: 'MO', headerRow: 2, dataColStart: 5 },
    { sheet: 'C.A.', grupo: 'CA', headerRow: 2, dataColStart: 5 },
    { sheet: 'M.B.', grupo: 'MB', headerRow: 2, dataColStart: 5 },
    { sheet: 'P.B.', grupo: 'PB', headerRow: 2, dataColStart: 5 },
    { sheet: 'AD',   grupo: 'AD', headerRow: 2, dataColStart: 5 },
  ];

  let sedesCount = 0;
  for (const cfg of sedeSheets) {
    const ws = wb.Sheets[cfg.sheet];
    if (!ws) continue;
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const headerRow = data[cfg.headerRow] || [];
    const gid = grupoMap[cfg.grupo];

    for (let c = cfg.dataColStart; c < headerRow.length; c++) {
      const nombre = clean(headerRow[c]);
      if (!nombre || nombre.length < 3) continue;
      const nombreUp = nombre.toUpperCase().trim();
      // Saltar columnas que parecen ser totales o sin nombre real
      if (/^(total|columna|col\d|x$|\d+$)/i.test(nombreUp)) continue;

      await client.query(
        `INSERT INTO sedes (grupo_id, nombre, col_excel) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [gid, nombreUp, c]
      );
      sedesCount++;
    }
  }
  console.log(`   ✅ ${sedesCount} sedes\n`);

  // ── 5. Productos — fuente primaria: Matriz Neg ─────────────────────────────
  console.log('📦 Productos desde Matriz Neg...');
  const wsMat = wb.Sheets['Matriz Neg'];
  const matData = XLSX.utils.sheet_to_json(wsMat, { header: 1, defval: null });
  // Row 0 = header, data desde row 1
  // Cols: 0=REF, 1=NOMBRE, 2=PRESENTACION, 3=TIPO, 4=STOCK_PROM, 5=CAT, 6=PROV1, 7=PRECIO1, 8=PROV2, 9=PRECIO2, 10=MONTERREY, 11=BEAUTE, 12=SUMICORP

  const matMap = {}; // codigo → producto enriquecido
  for (let i = 1; i < matData.length; i++) {
    const row = matData[i];
    if (!row || !row[0]) continue;
    const codigo = num(row[0]);
    if (!codigo || codigo < 1) continue;
    const nombre = str(row[1]);
    if (!nombre) continue;

    const prov1Nombre = str(row[6]) || '';
    let prov1Id = null;
    for (const [k,v] of Object.entries(provMap)) {
      if (prov1Nombre.length > 2 && k.startsWith(prov1Nombre.slice(0,6))) { prov1Id = v; break; }
    }
    // exact match first
    if (!prov1Id && provMap[prov1Nombre]) prov1Id = provMap[prov1Nombre];

    const prov2Nombre = str(row[8]) || '';
    let prov2Id = null;
    if (prov2Nombre && provMap[prov2Nombre]) prov2Id = provMap[prov2Nombre];

    matMap[codigo] = {
      codigo,
      nombre_estandar: nombre,
      presentacion: str(row[2]),
      tipo_insumo: mapTipo(row[3]),
      cat_rotacion: mapCat(row[5]),
      prov1Id,
      precio_lista: num(row[7]),
      prov2Id,
      precio2: num(row[9]),
      prec_monterrey: num(row[10]),
      prec_beaute: num(row[11]),
      prec_sumicorp: num(row[12]),
    };
  }
  console.log(`   ${Object.keys(matMap).length} en Matriz Neg`);

  // Enriquecer con Stock (para los que no están en Matriz Neg)
  console.log('📦 Enriqueciendo con Stock...');
  const wsStock = wb.Sheets['Stock'];
  const stockRaw = XLSX.utils.sheet_to_json(wsStock, { header: 1, defval: null });
  // Row 0 = header, data desde row 1
  // Cols: 0=Codigo, 1=Descripcion, 2=Cantidad real, 3=Cantidad disponible, 4=Entrante, 5=Saliente, 8=Columna3(categoria)

  const stockMap = {}; // codigo → {real, disp, entr, sal}
  const allCodigos = new Set(Object.keys(matMap).map(Number));

  for (let i = 1; i < stockRaw.length; i++) {
    const row = stockRaw[i];
    if (!row || row[0] === null || row[0] === undefined) continue;
    const codigo = num(row[0]);
    if (!codigo || codigo < 1) continue;

    stockMap[codigo] = {
      real: num(row[2]) ?? 0,
      disp: num(row[3]),
      entr: num(row[4]) ?? 0,
      sal:  num(row[5]) ?? 0,
      categoria: str(row[8]),
    };

    // Si no está en matMap, agregar desde Stock
    if (!matMap[codigo]) {
      const desc = String(row[1]||'').trim().toUpperCase();
      const { nombre, presentacion } = parsePresentacion(desc);
      const catStr = str(row[8]) || 'OTROS';
      matMap[codigo] = {
        codigo,
        nombre_estandar: nombre || desc,
        presentacion: presentacion || null,
        tipo_insumo: mapTipo(catStr),
        cat_rotacion: 'C',
        prov1Id: null, precio_lista: null,
        prov2Id: null, precio2: null,
        prec_monterrey: null, prec_beaute: null, prec_sumicorp: null,
      };
      allCodigos.add(codigo);
    }
  }
  console.log(`   ${allCodigos.size} productos totales\n`);

  // ── 6. Insertar productos ───────────────────────────────────────────────────
  console.log('📦 Insertando productos...');
  const prodMap = {}; // codigo → id
  const sortedCodigos = [...allCodigos].sort((a,b)=>a-b);
  let inserted = 0;

  for (let i = 0; i < sortedCodigos.length; i += 100) {
    const batch = sortedCodigos.slice(i, i+100);
    for (const codigo of batch) {
      const p = matMap[codigo];
      if (!p || !p.nombre_estandar) continue;
      const activo = p.tipo_insumo !== 'NO_DISPONIBLE';
      try {
        const r = await client.query(
          `INSERT INTO productos
            (codigo, nombre_estandar, presentacion, tipo_insumo, cat_rotacion,
             proveedor_id, precio_lista, activo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (codigo) DO UPDATE SET
             nombre_estandar=EXCLUDED.nombre_estandar, presentacion=EXCLUDED.presentacion,
             tipo_insumo=EXCLUDED.tipo_insumo, cat_rotacion=EXCLUDED.cat_rotacion,
             precio_lista=EXCLUDED.precio_lista, activo=EXCLUDED.activo, updated_at=NOW()
           RETURNING id`,
          [p.codigo, p.nombre_estandar, p.presentacion, p.tipo_insumo, p.cat_rotacion,
           p.prov1Id, p.precio_lista, activo]
        );
        if (r.rows.length) { prodMap[codigo] = r.rows[0].id; inserted++; }
      } catch(e) {
        // skip duplicates / errors silently
      }
    }
    process.stdout.write(`\r   ${inserted} insertados...`);
  }
  console.log(`\n   ✅ ${inserted} productos\n`);

  // ── 7. Stock ────────────────────────────────────────────────────────────────
  console.log('📊 Insertando stock...');
  let stockCount = 0;
  for (const [codigoStr, s] of Object.entries(stockMap)) {
    const prodId = prodMap[Number(codigoStr)];
    if (!prodId) continue;
    try {
      await client.query(
        `INSERT INTO stock (producto_id, cantidad_real, cantidad_disp, cantidad_entr, cantidad_sal)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (producto_id) DO UPDATE SET
           cantidad_real=EXCLUDED.cantidad_real, cantidad_disp=EXCLUDED.cantidad_disp,
           cantidad_entr=EXCLUDED.cantidad_entr, cantidad_sal=EXCLUDED.cantidad_sal, updated_at=NOW()`,
        [prodId, s.real, s.disp ?? s.real, s.entr, s.sal]
      );
      stockCount++;
    } catch(e) {}
  }
  console.log(`   ✅ ${stockCount} registros de stock\n`);

  // ── 8. Precios competidores ────────────────────────────────────────────────
  console.log('💰 Precios comparativos...');
  const precPairs = [
    ['MONTERREY', 'prec_monterrey'],
    ['BEAUTE',    'prec_beaute'],
    ['SUMICORP',  'prec_sumicorp'],
  ];
  let precCount = 0;
  for (const [codigo, p] of Object.entries(matMap)) {
    const prodId = prodMap[Number(codigo)];
    if (!prodId) continue;
    for (const [provNombre, field] of precPairs) {
      const precio = p[field];
      const provId = provMap[provNombre];
      if (!precio || !provId) continue;
      try {
        await client.query(
          `INSERT INTO precios_proveedor (producto_id, proveedor_id, precio)
           VALUES ($1,$2,$3) ON CONFLICT (producto_id, proveedor_id) DO UPDATE SET precio=EXCLUDED.precio`,
          [prodId, provId, precio]
        );
        precCount++;
      } catch(e) {}
    }
  }
  console.log(`   ✅ ${precCount} precios\n`);

  // ── 9. Pedidos por sede (distribución de Junio) ────────────────────────────
  console.log('📋 Pedidos de distribución Junio 2026...');
  const distSheets = [
    { sheet: 'M.O.', grupo: 'MO', headerRow: 2, dataColStart: 5, codigoCol: 0, nombreCol: 1 },
    { sheet: 'C.A.', grupo: 'CA', headerRow: 2, dataColStart: 5, codigoCol: 0, nombreCol: 1 },
    { sheet: 'M.B.', grupo: 'MB', headerRow: 2, dataColStart: 5, codigoCol: 0, nombreCol: 1 },
    { sheet: 'P.B.', grupo: 'PB', headerRow: 2, dataColStart: 5, codigoCol: 0, nombreCol: 1 },
    { sheet: 'AD',   grupo: 'AD', headerRow: 2, dataColStart: 5, codigoCol: 0, nombreCol: 1 },
  ];

  // Cargar mapa sedes por grupo y col_excel
  const sedeByGrupoCol = {};
  const sedeRows = await client.query('SELECT id, grupo_id, col_excel FROM sedes');
  for (const s of sedeRows.rows) {
    sedeByGrupoCol[`${s.grupo_id}::${s.col_excel}`] = s.id;
  }

  let pedidosCount = 0;
  const periodo = '2026-06-01';

  for (const cfg of distSheets) {
    const ws = wb.Sheets[cfg.sheet];
    if (!ws) continue;
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    const gid = grupoMap[cfg.grupo];

    for (let row = cfg.headerRow + 1; row < data.length; row++) {
      const r = data[row];
      if (!r) continue;
      const codigo = num(r[cfg.codigoCol]);
      if (!codigo || codigo < 1) continue;
      const prodId = prodMap[codigo];
      if (!prodId) continue;

      for (let c = cfg.dataColStart; c < r.length; c++) {
        const cantidad = num(r[c]);
        if (!cantidad || cantidad <= 0) continue;
        const sedeId = sedeByGrupoCol[`${gid}::${c}`];
        if (!sedeId) continue;
        try {
          await client.query(
            `INSERT INTO pedidos_sede (sede_id, producto_id, periodo, cantidad)
             VALUES ($1,$2,$3,$4) ON CONFLICT (sede_id, producto_id, periodo) DO UPDATE SET cantidad=EXCLUDED.cantidad`,
            [sedeId, prodId, periodo, cantidad]
          );
          pedidosCount++;
        } catch(e) {}
      }
    }
    process.stdout.write(`\r   ${pedidosCount} pedidos...`);
  }
  console.log(`\n   ✅ ${pedidosCount} pedidos de distribución\n`);

  // ── Resumen ────────────────────────────────────────────────────────────────
  const counts = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM proveedores)       AS proveedores,
      (SELECT COUNT(*) FROM productos)         AS productos,
      (SELECT COUNT(*) FROM productos WHERE activo=true) AS productos_activos,
      (SELECT COUNT(*) FROM stock)             AS stock,
      (SELECT COUNT(*) FROM sedes)             AS sedes,
      (SELECT COUNT(*) FROM grupos_contrato)   AS grupos,
      (SELECT COUNT(*) FROM pedidos_sede)      AS pedidos_sede,
      (SELECT COUNT(*) FROM precios_proveedor) AS precios,
      (SELECT COALESCE(SUM(cantidad_real),0) FROM stock) AS total_unidades
  `);
  const c = counts.rows[0];

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║   ✅ CARGA COMPLETA — DATOS REALES    ║');
  console.log('╠══════════════════════════════════════╣');
  console.log(`║  Proveedores:        ${String(c.proveedores).padEnd(14)}║`);
  console.log(`║  Productos (total):  ${String(c.productos).padEnd(14)}║`);
  console.log(`║  Productos activos:  ${String(c.productos_activos).padEnd(14)}║`);
  console.log(`║  Stock (productos):  ${String(c.stock).padEnd(14)}║`);
  console.log(`║  Total unidades:     ${String(Math.round(c.total_unidades)).padEnd(14)}║`);
  console.log(`║  Grupos contrato:    ${String(c.grupos).padEnd(14)}║`);
  console.log(`║  Sedes:              ${String(c.sedes).padEnd(14)}║`);
  console.log(`║  Pedidos Junio:      ${String(c.pedidos_sede).padEnd(14)}║`);
  console.log(`║  Precios compet.:    ${String(c.precios).padEnd(14)}║`);
  console.log('╚══════════════════════════════════════╝\n');

  await client.end();
}

main().catch(e => { console.error('\nFATAL:', e.message); process.exit(1); });

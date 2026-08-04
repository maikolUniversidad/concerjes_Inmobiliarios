/**
 * Carga las dos órdenes de insumo físicas de julio 2026 que faltaron registrar.
 *
 *   node --use-system-ca scripts/cargar-ordenes-insumo-julio2026.mjs
 *
 * Órdenes:
 *   1. UNAD CURUMANI  — 29/07/2026 — AJUSTE PEDIDO JULIO-AGOSTO
 *   2. SOGAMOSO       — 10/07/2026 — ASECOLBAS
 */

import pg from 'pg';

const { Client } = pg;
const DB_URL = 'postgresql://postgres.esehmwmtevwrqxvbzmev:S9qxOMoOZCepMyke@aws-1-us-west-2.pooler.supabase.com:5432/postgres';

// ── Datos de las dos órdenes (extraídos de los documentos físicos) ─────────────

const ORDENES = [
  {
    sede_buscar:  'UNAD CURUMANI',        // fragmento del nombre de la sede
    numero:       'OI-202607-UNAD-CUR',
    fecha:        '2026-07-29',
    observacion:  'AJUSTE PEDIDO JULIO-AGOSTO. Entregado por: MARIA PATRICIA BARBOSA - COORDINADORA OPERATIVA. Entregado a: OPERARIAS(OS) DE ASEO Y CAFETERIA.',
    estado:       'DESPACHADO',
    items: [
      { ref: 663, descripcion: 'PAPEL HIGIENICO JUMBO FAMILIA TIPO UNAD',              cantidad: 16,  unidad: 'ROLLO X 250 MT'  },
      { ref: 703, descripcion: 'TOALLA PARA MANOS NATURAL TIPO FAMILIA',               cantidad: 20,  unidad: 'ROLLO X 100 MT'  },
      { ref: 170, descripcion: 'CAFE DE ORIGEN TOSTADO Y MOLIDO (OMA INSTITUCIONAL)',   cantidad: 10,  unidad: 'PAQUETE X LIBRA' },
      { ref: 174, descripcion: 'AZUCAR BLANCA EN SOBRE DE 5G',                         cantidad: 5,   unidad: 'PAQUETE X 200 UN'},
      { ref: 155, descripcion: 'VASOS DE CARTON BIODEGRADABLES 4 OZ',                  cantidad: 50,  unidad: 'PAQUETE X 50 UN' },
      { ref: 156, descripcion: 'VASOS DE CARTON BIODEGRADABLES 6 OZ',                  cantidad: 30,  unidad: 'PAQUETE X 50 UN' },
    ],
  },
  {
    sede_buscar:  'SOGAMOSO',
    numero:       'OI-202607-SOGAMOSO',
    fecha:        '2026-07-10',
    observacion:  'Entregado por: ASECOLBAS. Formato Entrega de Servicios y Elementos — Gestión Logística v3.',
    estado:       'DESPACHADO',
    items: [
      { ref: 174, descripcion: 'AZUCAR',                              cantidad: 5,  unidad: 'PQ 200 SOBRES' },
      { ref: 170, descripcion: 'CAFÉ',                                cantidad: 10, unidad: 'LIBRA'         },
      { ref: 663, descripcion: 'PAPELHIGIENICO BLANCO DOBLE HOJA',    cantidad: 16, unidad: 'ROLLO X 250 MTS'},
      { ref: 703, descripcion: 'TOALLA PARA MANOS EN COLOR NATURAL',  cantidad: 20, unidad: 'ROLLO X 100 MTS'},
      { ref: 155, descripcion: 'VASOS DE CARTON 4 ONZAS',             cantidad: 20, unidad: 'PAQUETE X 50'  },
      { ref: 156, descripcion: 'VASOS DE CARTON 7 ONZAS',             cantidad: 5,  unidad: 'PAQUETE X 50'  },
    ],
  },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function padNum(n, len = 3) { return String(n).padStart(len, '0'); }

async function main() {
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  console.log('✅ Conectado a Supabase');

  try {
    // ── Obtener un usuario admin para creado_por ─────────────────────────────
    const { rows: [adminUser] } = await db.query(`
      SELECT id FROM public.usuarios WHERE rol IN ('SUPER_ADMIN','ADMIN') LIMIT 1
    `);
    if (!adminUser) throw new Error('No se encontró usuario admin en la tabla usuarios');
    const creado_por = adminUser.id;
    console.log(`👤 creado_por: ${creado_por}`);

    for (const orden of ORDENES) {
      console.log(`\n── Procesando orden: ${orden.numero} (${orden.sede_buscar}) ──`);

      // ── Buscar sede ────────────────────────────────────────────────────────
      const { rows: sedes } = await db.query(`
        SELECT id, nombre FROM public.sedes
        WHERE UPPER(nombre) ILIKE $1 AND activo = true
        LIMIT 3
      `, [`%${orden.sede_buscar.toUpperCase()}%`]);

      if (sedes.length === 0) {
        // Intentar sin "UNAD " si no encuentra
        const keyword = orden.sede_buscar.replace(/^UNAD\s+/i, '');
        const { rows: sedes2 } = await db.query(`
          SELECT id, nombre FROM public.sedes
          WHERE UPPER(nombre) ILIKE $1 AND activo = true
          LIMIT 3
        `, [`%${keyword.toUpperCase()}%`]);

        if (sedes2.length === 0) {
          console.warn(`⚠️  No se encontró sede para "${orden.sede_buscar}" — saltando orden`);
          continue;
        }
        sedes.push(...sedes2);
      }

      const sede = sedes[0];
      console.log(`📍 Sede encontrada: "${sede.nombre}" (${sede.id})`);
      if (sedes.length > 1) console.log(`   (había ${sedes.length} coincidencias, se usó la primera)`);

      // ── Verificar que el número de orden no exista ya ──────────────────────
      const { rows: exist } = await db.query(
        `SELECT id FROM public.ordenes_insumo WHERE numero = $1`, [orden.numero]
      );
      if (exist.length > 0) {
        console.log(`ℹ️  La orden ${orden.numero} ya existe (id: ${exist[0].id}) — saltando`);
        continue;
      }

      // ── Insertar cabecera de la orden ─────────────────────────────────────
      const periodo = orden.fecha.slice(0, 7) + '-01'; // primer día del mes
      const { rows: [nuevaOrden] } = await db.query(`
        INSERT INTO public.ordenes_insumo
          (numero, sede_id, estado, periodo, observacion, creado_por,
           despachado_at, created_at, updated_at)
        VALUES ($1, $2, $3::public.estado_orden_insumo, $4, $5, $6,
                $7::timestamptz, now(), now())
        RETURNING id
      `, [
        orden.numero,
        sede.id,
        orden.estado,
        periodo,
        orden.observacion,
        creado_por,
        orden.fecha + 'T12:00:00-05:00',
      ]);
      console.log(`📋 Orden creada: ${nuevaOrden.id}`);

      // ── Insertar ítems ─────────────────────────────────────────────────────
      let itemsInsertados = 0;
      let itemsNoEncontrados = [];

      for (const item of orden.items) {
        // Buscar producto por REF (número de ítem del documento)
        const { rows: prods } = await db.query(`
          SELECT id, ref, nombre_estandar FROM public.productos
          WHERE ref = $1 AND activo = true
          LIMIT 1
        `, [item.ref]);

        if (prods.length === 0) {
          // Intentar también por código
          const { rows: porCodigo } = await db.query(`
            SELECT id, codigo, nombre_estandar FROM public.productos
            WHERE codigo = $1 AND activo = true
            LIMIT 1
          `, [item.ref]);

          if (porCodigo.length === 0) {
            itemsNoEncontrados.push({ ref: item.ref, descripcion: item.descripcion });
            console.warn(`  ⚠️  REF/cód ${item.ref} (${item.descripcion}) — producto no encontrado, se omite`);
            continue;
          }
          prods.push(...porCodigo);
        }

        const prod = prods[0];

        // Verificar que no haya duplicado (orden_id, producto_id)
        const { rows: dupCheck } = await db.query(`
          SELECT id FROM public.orden_insumo_items
          WHERE orden_id = $1 AND producto_id = $2
        `, [nuevaOrden.id, prod.id]);

        if (dupCheck.length > 0) {
          console.log(`  ↩️  Ítem ${item.ref} ya existe en la orden — saltando`);
          continue;
        }

        await db.query(`
          INSERT INTO public.orden_insumo_items
            (orden_id, producto_id, cantidad_solicitada, cantidad_alistada,
             es_adicional, created_at)
          VALUES ($1, $2, $3, $3, false, now())
        `, [nuevaOrden.id, prod.id, item.cantidad]);

        console.log(`  ✅ Ítem insertado: REF ${item.ref} — ${prod.nombre_estandar} × ${item.cantidad} (${item.unidad})`);
        itemsInsertados++;
      }

      console.log(`\n  📦 ${itemsInsertados}/${orden.items.length} ítems insertados`);
      if (itemsNoEncontrados.length > 0) {
        console.log(`  ⚠️  No encontrados en BD:`);
        itemsNoEncontrados.forEach(i => console.log(`       - REF ${i.ref}: ${i.descripcion}`));
      }
    }

    console.log('\n🎉 Carga completada');
  } catch (err) {
    console.error('❌ Error:', err.message);
    throw err;
  } finally {
    await db.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });

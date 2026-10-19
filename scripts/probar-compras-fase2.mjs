// Pruebas de comportamiento de la FASE 2 del módulo de compras (la solicitud),
// contra la base REAL dentro de una transacción que se revierte al final.
//
// Qué comprueba: los permisos (quién puede solicitar, quién convertir), la
// generación desde la recomendación agrupando por proveedor, la generación
// desde una orden pendiente por falta de stock sin duplicar, la numeración
// SC-YYYYMM-NNN por máximo del período, la conversión a una orden de compra por
// proveedor con el precio del comparador o el de lista, y que la orden de
// compra siga pudiendo nacer SIN solicitud (decisión §7.1).
//
// No deja nada escrito: todo va dentro de BEGIN … ROLLBACK.
// Uso: node --use-system-ca scripts/probar-compras-fase2.mjs
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
if (!m) { console.error('No se encontró DIRECT_URL en .env.local'); process.exit(1) }

const c = new Client({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } })
await c.connect()
let ok = 0, fail = 0
const check = (titulo, cond, detalle = '') => {
  if (cond) { ok++; console.log(`  ✅ ${titulo}${detalle ? ' · ' + detalle : ''}`) }
  else { fail++; console.log(`  ❌ ${titulo}${detalle ? ' · ' + detalle : ''}`) }
}
const como = async (uid) => {
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated' })])
  await c.query(`SET LOCAL ROLE authenticated`)
}
const comoDueno = async () => { await c.query(`RESET ROLE`) }
// Un error aborta la transacción, así que cada prueba que DEBE fallar va dentro
// de su propio SAVEPOINT.
let sp = 0
const falla = async (sql, params = []) => {
  const nombre = `p${++sp}`
  await c.query(`SAVEPOINT ${nombre}`)
  try { await c.query(sql, params); await c.query(`RELEASE SAVEPOINT ${nombre}`); return null }
  catch (e) { await c.query(`ROLLBACK TO SAVEPOINT ${nombre}`); return e.message }
}

await c.query('BEGIN')
try {
  // Usuarios de prueba por rol (sin nombres: solo ids)
  const { rows: us } = await c.query(`
    SELECT r.nombre rol, MIN(u.id::text) id FROM usuarios u JOIN roles r ON r.id = u.rol_id
     WHERE r.nombre IN ('Coordinador de Compras','Bodeguero','Coordinador','Conserje') AND u.activo
     GROUP BY r.nombre`)
  const uid = Object.fromEntries(us.map((r) => [r.rol, r.id]))
  console.log('Usuarios de prueba:', Object.keys(uid).join(', '))

  // ── 1. Sin permiso no se crea solicitud ───────────────────────────────────
  console.log('\n1) Permisos')
  await como(uid['Conserje'])
  let e = await falla(`SELECT sc_crear($1::jsonb)`, [JSON.stringify([{ producto_id: null, cantidad: 1 }])])
  check('Conserje (sin solicitar_compras) no puede crear solicitud', /No tienes permiso para crear solicitudes/.test(e || ''), e)

  await como(uid['Bodeguero'])
  const { rows: lect } = await c.query(`SELECT COUNT(*) n FROM solicitudes_compra`)
  check('Bodeguero (con solicitar_compras) puede LEER solicitudes', lect.length === 1, `${lect[0].n} filas`)

  await como(uid['Conserje'])
  const { rows: lect2 } = await c.query(`SELECT COUNT(*) n FROM solicitudes_compra`)
  check('Conserje no ve ninguna solicitud (RLS)', lect2[0].n === '0')

  // ── 2. Generar desde la recomendación, agrupando por proveedor ────────────
  console.log('\n2) Generar desde la recomendación')
  await como(uid['Coordinador de Compras'])
  const { rows: gen } = await c.query(`SELECT sc_generar_desde_recomendacion() AS r`)
  const sols = gen[0].r.solicitudes
  check('Crea una solicitud por proveedor', gen[0].r.total === 8, `${gen[0].r.total} solicitudes`)
  const sinProv = sols.filter((s) => !s.proveedor_id)
  check('Los productos sin proveedor quedan en una solicitud aparte', sinProv.length === 1,
    sinProv.length ? `${sinProv[0].numero} con ${sinProv[0].productos} productos` : '')

  const { rows: nums } = await c.query(`
    SELECT numero, origen::text, estado::text, prioridad::text, solicitado_por IS NOT NULL dueno,
           (SELECT COUNT(*) FROM solicitud_compra_items i WHERE i.solicitud_id = s.id) items
      FROM solicitudes_compra s ORDER BY numero`)
  const prefijo = 'SC-' + new Date().toISOString().slice(0, 7).replace('-', '') + '-'
  check('Numeración SC-YYYYMM-NNN consecutiva sin huecos ni repetidos',
    nums.every((r, i) => r.numero === prefijo + String(i + 1).padStart(3, '0')),
    nums.map((r) => r.numero).join(' '))
  check('Nacen en BORRADOR y con origen RECOMENDACION',
    nums.every((r) => r.estado === 'BORRADOR' && r.origen === 'RECOMENDACION' && r.dueno))

  // Numeración bajo concurrencia: el máximo del período, no el conteo.
  await c.query(`DELETE FROM solicitudes_compra WHERE numero = $1`, [prefijo + '003'])
  const { rows: g2 } = await c.query(`SELECT sc_generar_desde_recomendacion($1::jsonb) AS r`,
    [JSON.stringify([{ producto_id: (await c.query(`SELECT producto_id FROM v_recomendacion_compra_proveedor WHERE recomendado>0 AND proveedor_sugerido_id IS NOT NULL LIMIT 1`)).rows[0].producto_id }])])
  check('Tras borrar la 003, la siguiente es la 009 (máximo, no conteo)',
    g2[0].r.solicitudes[0].numero === prefijo + '009', g2[0].r.solicitudes[0].numero)

  // Cantidad: el cliente solo puede pedir menos de lo recomendado
  const { rows: prod } = await c.query(`
    SELECT producto_id, recomendado FROM v_recomendacion_compra_proveedor
     WHERE recomendado > 10 AND proveedor_sugerido_id IS NOT NULL LIMIT 1`)
  const { rows: g3 } = await c.query(`SELECT sc_generar_desde_recomendacion($1::jsonb) AS r`,
    [JSON.stringify([{ producto_id: prod[0].producto_id, cantidad: Number(prod[0].recomendado) * 100 }])])
  const { rows: cant } = await c.query(`
    SELECT cantidad FROM solicitud_compra_items WHERE solicitud_id = $1`, [g3[0].r.solicitudes[0].solicitud_id])
  check('Una cantidad mayor que la recomendada se recorta a la recomendada',
    Number(cant[0].cantidad) === Number(prod[0].recomendado), `pidió ${Number(prod[0].recomendado) * 100}, quedó ${cant[0].cantidad}`)

  // ── 3. Generar desde una orden pendiente por falta de stock ───────────────
  console.log('\n3) Generar desde una orden pendiente')
  const { rows: pend } = await c.query(`
    SELECT orden_insumo_id, numero, items, unidades FROM v_sc_pendientes_sin_solicitud
     ORDER BY created_at DESC LIMIT 1`)
  const { rows: sp } = await c.query(`SELECT sc_generar_desde_pendiente($1) AS id`, [pend[0].orden_insumo_id])
  const { rows: det } = await c.query(`
    SELECT s.numero, s.origen::text, s.prioridad::text, s.sede_id IS NOT NULL con_sede, s.contrato_id,
           COUNT(i.id) items, SUM(i.cantidad) unidades,
           COUNT(i.orden_insumo_id) con_oi, COUNT(i.proveedor_sugerido_id) con_prov
      FROM solicitudes_compra s JOIN solicitud_compra_items i ON i.solicitud_id = s.id
     WHERE s.id = $1 GROUP BY 1,2,3,4,5`, [sp[0].id])
  check('Una solicitud por orden pendiente, con origen PENDIENTE_DESPACHO',
    det[0].origen === 'PENDIENTE_DESPACHO' && det[0].items === String(pend[0].items),
    `${det[0].numero}: ${det[0].items} ítems, ${det[0].unidades} uds`)
  check('Lleva la sede de la orden y prioridad ALTA o URGENTE',
    det[0].con_sede && ['ALTA', 'URGENTE'].includes(det[0].prioridad), det[0].prioridad)
  check('Cada ítem queda enlazado a la orden pendiente (orden_insumo_id)',
    det[0].con_oi === det[0].items)
  check('contrato_id en NULL: el módulo de contratos todavía no lo llena', det[0].contrato_id === null)

  e = await falla(`SELECT sc_generar_desde_pendiente($1)`, [pend[0].orden_insumo_id])
  check('No se duplica: la segunda vez avisa que ya tiene solicitud', /ya tiene solicitud/.test(e || ''), e)

  const { rows: fuera } = await c.query(`SELECT COUNT(*) n FROM v_sc_pendientes_sin_solicitud WHERE orden_insumo_id = $1`, [pend[0].orden_insumo_id])
  check('La orden ya no aparece en el panel de pendientes sin solicitud', fuera[0].n === '0')

  const { rows: desp } = await c.query(`
    SELECT id, numero FROM ordenes_insumo WHERE orden_origen_id IS NOT NULL AND estado = 'DESPACHADO' LIMIT 1`)
  if (desp.length) {
    e = await falla(`SELECT sc_generar_desde_pendiente($1)`, [desp[0].id])
    check('Una pendiente ya despachada no genera solicitud (el stock apareció)', /ya no hay nada que comprar/.test(e || ''), e)
  }

  // ── 4. Conversión a orden de compra ───────────────────────────────────────
  console.log('\n4) Conversión a orden de compra')
  const solPend = sols.find((s) => s.proveedor_id)
  await como(uid['Bodeguero'])
  e = await falla(`SELECT sc_convertir_a_oc($1)`, [solPend.solicitud_id])
  check('Bodeguero (sin crear_ordenes_compra) no puede convertir', /requiere el permiso de crear órdenes/.test(e || ''), e)

  await como(uid['Coordinador de Compras'])
  const { rows: conv } = await c.query(`SELECT sc_convertir_a_oc($1) AS r`, [solPend.solicitud_id])
  check('Una orden de compra por proveedor', conv[0].r.total === 1,
    `${conv[0].r.ordenes.map((o) => o.numero + ' ' + o.proveedor).join(', ')}`)
  const { rows: oc } = await c.query(`
    SELECT o.numero_oc, o.estado::text, o.solicitud_id IS NOT NULL enlazada, o.valor_total,
           o.bodega_destino_id IS NOT NULL con_bodega, COUNT(it.id) items,
           SUM(it.subtotal) suma_subtotales
      FROM ordenes_compra o JOIN oc_items it ON it.oc_id = o.id
     WHERE o.solicitud_id = $1 GROUP BY 1,2,3,4,5`, [solPend.solicitud_id])
  check('La orden nace en BORRADOR, enlazada por solicitud_id y con bodega',
    oc[0].estado === 'BORRADOR' && oc[0].enlazada && oc[0].con_bodega, oc[0].numero_oc)
  check('valor_total coincide con la suma de los subtotales generados',
    Math.abs(Number(oc[0].valor_total) - Number(oc[0].suma_subtotales)) < 0.01,
    `${oc[0].valor_total} vs ${oc[0].suma_subtotales}`)

  const { rows: precios } = await c.query(`
    SELECT COUNT(*) total,
           COUNT(*) FILTER (WHERE it.precio_unit = pp.precio) desde_comparador,
           COUNT(*) FILTER (WHERE pp.precio IS NULL AND it.precio_unit = p.precio_lista) desde_lista
      FROM oc_items it
      JOIN ordenes_compra o ON o.id = it.oc_id
      JOIN productos p ON p.id = it.producto_id
      LEFT JOIN precios_proveedor pp
             ON pp.producto_id = it.producto_id AND pp.proveedor_id = o.proveedor_id
            AND COALESCE(pp.vigente, true) AND pp.precio > 0
     WHERE o.solicitud_id = $1`, [solPend.solicitud_id])
  check('El precio sale del comparador y, si no hay, del precio de lista',
    Number(precios[0].total) === Number(precios[0].desde_comparador) + Number(precios[0].desde_lista),
    `${precios[0].desde_comparador} del comparador + ${precios[0].desde_lista} de lista = ${precios[0].total}`)

  const { rows: est } = await c.query(`
    SELECT estado::text, (SELECT COUNT(*) FROM solicitud_compra_items i WHERE i.solicitud_id = s.id AND i.oc_id IS NOT NULL) convertidos
      FROM solicitudes_compra s WHERE s.id = $1`, [solPend.solicitud_id])
  check('La solicitud queda CONVERTIDA y sus ítems apuntan a la orden',
    est[0].estado === 'CONVERTIDA' && Number(est[0].convertidos) > 0, `${est[0].estado}, ${est[0].convertidos} ítems`)

  e = await falla(`SELECT sc_convertir_a_oc($1)`, [solPend.solicitud_id])
  check('No se convierte dos veces', /ya no se puede convertir/.test(e || ''), e)

  e = await falla(`SELECT sc_convertir_a_oc($1)`, [sinProv[0].solicitud_id])
  check('La solicitud sin proveedor no se convierte y lo dice claro',
    /tiene proveedor/.test(e || ''), e)

  // El proveedor que SÍ tiene precios en el comparador (40 productos medidos)
  const { rows: solComp } = await c.query(`
    SELECT s.id FROM solicitudes_compra s
     WHERE s.origen = 'RECOMENDACION' AND s.estado = 'BORRADOR' AND s.proveedor_sugerido_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM solicitud_compra_items i WHERE i.solicitud_id = s.id AND i.fuente_precio = 'COMPARADOR')
     LIMIT 1`)
  await c.query(`SELECT sc_convertir_a_oc($1)`, [solComp[0].id])
  const { rows: pComp } = await c.query(`
    SELECT COUNT(*) total, COUNT(*) FILTER (WHERE it.precio_unit = pp.precio) del_comparador
      FROM oc_items it
      JOIN ordenes_compra o ON o.id = it.oc_id
      JOIN precios_proveedor pp ON pp.producto_id = it.producto_id AND pp.proveedor_id = o.proveedor_id
           AND COALESCE(pp.vigente, true) AND pp.precio > 0
     WHERE o.solicitud_id = $1`, [solComp[0].id])
  check('Con el proveedor del comparador, el precio de la orden es el del comparador',
    Number(pComp[0].total) > 0 && pComp[0].total === pComp[0].del_comparador,
    `${pComp[0].del_comparador} de ${pComp[0].total} ítems`)

  // Mezcla: un producto con proveedor y otro sin ninguno → PARCIAL
  const { rows: huerfano } = await c.query(`
    SELECT producto_id FROM v_recomendacion_compra_proveedor
     WHERE recomendado > 0 AND proveedor_sugerido_id IS NULL LIMIT 1`)
  const { rows: mix } = await c.query(`SELECT sc_crear($1::jsonb) AS id`, [JSON.stringify([
    { producto_id: prod[0].producto_id, cantidad: 3 },
    { producto_id: huerfano[0].producto_id, cantidad: 4 },
  ])])
  const { rows: convMix } = await c.query(`SELECT sc_convertir_a_oc($1) AS r`, [mix[0].id])
  const { rows: estMix } = await c.query(`SELECT estado::text FROM solicitudes_compra WHERE id = $1`, [mix[0].id])
  check('Mezcla con y sin proveedor: una orden, el resto queda y la solicitud va a PARCIAL',
    convMix[0].r.total === 1 && convMix[0].r.sin_proveedor === 1 && estMix[0].estado === 'PARCIAL',
    `${convMix[0].r.total} orden, ${convMix[0].r.sin_proveedor} sin proveedor, estado ${estMix[0].estado}`)

  // Conversión que parte en varias órdenes: la de la pendiente toca varios proveedores
  const { rows: convP } = await c.query(`SELECT sc_convertir_a_oc($1) AS r`, [sp[0].id])
  check('La solicitud de la pendiente se parte en una orden por proveedor',
    convP[0].r.total >= 1,
    `${convP[0].r.total} orden(es), ${convP[0].r.sin_proveedor} producto(s) sin proveedor quedaron en la solicitud`)
  const { rows: estP } = await c.query(`SELECT estado::text FROM solicitudes_compra WHERE id = $1`, [sp[0].id])
  check('Si quedaron productos sin proveedor, la solicitud queda PARCIAL y no CONVERTIDA',
    convP[0].r.sin_proveedor > 0 ? estP[0].estado === 'PARCIAL' : estP[0].estado === 'CONVERTIDA',
    estP[0].estado)

  // ── 5. La orden sigue pudiendo nacer sin solicitud (§7.1) ─────────────────
  console.log('\n5) La solicitud NO es obligatoria')
  await comoDueno()
  const { rows: libre } = await c.query(`
    INSERT INTO ordenes_compra (numero_oc, proveedor_id, periodo, estado, valor_total, creado_por)
    VALUES ('OC-TEST-999', (SELECT id FROM proveedores LIMIT 1), date_trunc('month', CURRENT_DATE)::date,
            'BORRADOR', 1000, (SELECT id FROM usuarios LIMIT 1))
    RETURNING numero_oc, solicitud_id`)
  check('Se puede crear una orden de compra sin solicitud', libre[0].solicitud_id === null)

  // ── 6. Estados de la solicitud ────────────────────────────────────────────
  console.log('\n6) Estados')
  await como(uid['Coordinador'])
  const { rows: nueva } = await c.query(`SELECT sc_crear($1::jsonb, 'MANUAL', NULL, 'ALTA', 'prueba') AS id`,
    [JSON.stringify([{ producto_id: prod[0].producto_id, cantidad: 5 }])])
  await c.query(`SELECT sc_cambiar_estado($1, 'ENVIADA')`, [nueva[0].id])
  const { rows: env } = await c.query(`SELECT estado::text, enviada_at IS NOT NULL fecha FROM solicitudes_compra WHERE id = $1`, [nueva[0].id])
  check('Un Coordinador crea una solicitud manual y la envía', env[0].estado === 'ENVIADA' && env[0].fecha)
  e = await falla(`SELECT sc_cambiar_estado($1, 'ENVIADA')`, [nueva[0].id])
  check('No se envía dos veces', /Solo se puede enviar una solicitud en borrador/.test(e || ''), e)
  e = await falla(`SELECT sc_cambiar_estado($1, 'RECHAZADA', 'no alcanza el presupuesto')`, [nueva[0].id])
  check('Rechazar es de compras, no de quien solicita', /requiere el permiso de crear órdenes/.test(e || ''), e)
  e = await falla(`SELECT sc_cambiar_estado($1, 'ANULADA')`, [nueva[0].id])
  check('Anular sin motivo se rechaza', /Escribe el motivo/.test(e || ''), e)
  await c.query(`SELECT sc_cambiar_estado($1, 'ANULADA', 'pedido duplicado')`, [nueva[0].id])
  const { rows: an } = await c.query(`SELECT estado::text, motivo_cierre FROM solicitudes_compra WHERE id = $1`, [nueva[0].id])
  check('Anulada con motivo', an[0].estado === 'ANULADA' && !!an[0].motivo_cierre, an[0].motivo_cierre)

  await como(uid['Coordinador de Compras'])
  const { rows: nueva2 } = await c.query(`SELECT sc_crear($1::jsonb) AS id`,
    [JSON.stringify([{ producto_id: prod[0].producto_id, cantidad: 2 }])])
  await c.query(`SELECT sc_cambiar_estado($1, 'RECHAZADA', 'hay stock en otra sede')`, [nueva2[0].id])
  const { rows: re } = await c.query(`SELECT estado::text FROM solicitudes_compra WHERE id = $1`, [nueva2[0].id])
  check('Compras rechaza con motivo', re[0].estado === 'RECHAZADA')
  e = await falla(`SELECT sc_convertir_a_oc($1)`, [nueva2[0].id])
  check('Una solicitud rechazada no se convierte', /ya no se puede convertir/.test(e || ''), e)
} finally {
  await c.query('ROLLBACK')
  await comoDueno()
}

const { rows: limpio } = await c.query(`SELECT COUNT(*) n FROM solicitudes_compra`)
console.log(`\nTras el ROLLBACK quedan ${limpio[0].n} solicitudes en la base (debe ser 0).`)
console.log(`\n${fail === 0 ? '✅' : '❌'} ${ok} prueba(s) bien, ${fail} mal.`)
await c.end()
process.exit(fail === 0 ? 0 : 1)

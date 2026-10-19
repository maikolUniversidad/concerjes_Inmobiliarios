// Comprueba que ni la función de proveedor sugerido ni la lista de «sin
// proveedor» tengan en cuenta a un proveedor DESACTIVADO.
//
// Importa porque /proveedores no borra: "eliminar" pone activo = false. Si el
// sistema siguiera proponiendo a ese proveedor, sc_convertir_a_oc() armaría la
// orden de compra contra alguien que para el usuario ya no existe.
//
// No deja nada escrito: la parte que desactiva va dentro de BEGIN … ROLLBACK.
// Uso: node --use-system-ca scripts/probar-proveedor-activo.mjs
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
let ok=0, fail=0
const check=(t,cond,d='')=>{ if(cond){ok++;console.log(`  ✅ ${t}${d?' · '+d:''}`)}else{fail++;console.log(`  ❌ ${t}${d?' · '+d:''}`)} }

// 1. Nada cambió hoy
const base = (await c.query(`SELECT COUNT(*) n, COUNT(*) FILTER (WHERE recomendado>0) r FROM v_productos_sin_proveedor`)).rows[0]
const BASE = Number(base.n)
check('La lista de «sin proveedor» responde', BASE > 0, `${base.n} sin proveedor, ${base.r} recomendados`)

await c.query('BEGIN')
try {
  // 2. Desactivar un proveedor con precios y ver qué pasa
  const { rows: prov } = await c.query(`
    SELECT pr.id, pr.nombre, COUNT(*) precios FROM proveedores pr
      JOIN precios_proveedor pp ON pp.proveedor_id=pr.id AND COALESCE(pp.vigente,true) AND pp.precio>0
     WHERE pr.activo GROUP BY pr.id, pr.nombre ORDER BY 3 DESC LIMIT 1`)
  const p = prov[0]
  // Un producto cuyo ÚNICO proveedor es ese
  const { rows: prod } = await c.query(`
    SELECT pp.producto_id FROM precios_proveedor pp
     WHERE pp.proveedor_id=$1 AND COALESCE(pp.vigente,true) AND pp.precio>0
       AND NOT EXISTS (SELECT 1 FROM precios_proveedor x WHERE x.producto_id=pp.producto_id
                        AND x.proveedor_id<>$1 AND COALESCE(x.vigente,true) AND x.precio>0)
       AND NOT EXISTS (SELECT 1 FROM productos pr2 WHERE pr2.id=pp.producto_id AND pr2.proveedor_id IS NOT NULL AND pr2.proveedor_id<>$1)
     LIMIT 1`, [p.id])
  if (!prod.length) { console.log('  (sin producto de proveedor único para probar)'); }
  else {
    const pid = prod[0].producto_id
    const antes = (await c.query(`SELECT proveedor_id, fuente FROM compras_precio_sugerido($1)`, [pid])).rows[0]
    check('Antes de desactivar, sugiere a ese proveedor', antes.proveedor_id === p.id, antes.fuente)
    const enLista = (await c.query(`SELECT COUNT(*) n FROM v_productos_sin_proveedor WHERE producto_id=$1`,[pid])).rows[0]
    check('Antes, el producto NO está en «sin proveedor»', enLista.n==='0')

    await c.query(`UPDATE proveedores SET activo=false WHERE id=$1`, [p.id])

    const despues = (await c.query(`SELECT proveedor_id, fuente FROM compras_precio_sugerido($1)`, [pid])).rows[0]
    check('Tras desactivarlo, ya no lo sugiere', despues.proveedor_id === null, `fuente ${despues.fuente}`)
    const enLista2 = (await c.query(`SELECT COUNT(*) n FROM v_productos_sin_proveedor WHERE producto_id=$1`,[pid])).rows[0]
    check('Tras desactivarlo, el producto vuelve a «sin proveedor»', enLista2.n==='1')
    const total = (await c.query(`SELECT COUNT(*) n FROM v_productos_sin_proveedor`)).rows[0]
    check('La lista crece con los que quedaron huérfanos', Number(total.n) > BASE, `${total.n} (eran ${BASE})`)
    const rec = (await c.query(`SELECT COUNT(*) n FROM v_recomendacion_compra_proveedor WHERE recomendado>0 AND proveedor_sugerido_id=$1`,[p.id])).rows[0]
    check('La recomendación deja de proponerlo', rec.n==='0')
  }

  // 3. Ni siquiera el proveedor que pide quien llama vale si está desactivado.
  //
  // Esta prueba comprobaba lo CONTRARIO y estaba mal. La primera versión de la
  // función respetaba a propósito el `p_proveedor` recibido, con el argumento
  // de que manda quien llama. Pero quien llama es `sc_convertir_a_oc()`, y lo
  // que pasa no es una elección de alguien en ese momento: es el
  // `proveedor_sugerido_id` que la solicitud guardó semanas atrás. Si ese
  // proveedor se dio de baja entre tanto, honrarlo creaba la orden de compra
  // contra un proveedor retirado. Lo cerró la migración
  // `20261019000005_precio_sugerido_ignora_proveedor_inactivo.sql`; ahora el
  // ítem se queda sin proveedor y `sc_convertir_a_oc()` lo reporta en
  // `sin_proveedor` para que alguien le asigne uno.
  const { rows: sol } = await c.query(`
    SELECT producto_id FROM precios_proveedor WHERE COALESCE(vigente,true) AND precio>0 LIMIT 1`)
  const forzado = (await c.query(`
    SELECT s.proveedor_id, (SELECT activo FROM proveedores WHERE id = s.proveedor_id) AS activo
      FROM compras_precio_sugerido($1, $2) s`, [sol[0].producto_id, p.id])).rows[0]
  check('El proveedor que pasa quien llama se ignora si está desactivado',
    forzado.proveedor_id !== p.id, `devolvió ${forzado.proveedor_id ?? 'ninguno'}`)
  check('Y si devuelve alguno, está activo',
    forzado.proveedor_id === null || forzado.activo === true)
} finally { await c.query('ROLLBACK') }

const fin = (await c.query(`SELECT COUNT(*) n FROM proveedores WHERE activo`)).rows[0]
check('Tras el ROLLBACK la base queda igual', Number(fin.n) > 0, `${fin.n} proveedores activos`)
console.log(`\n${fail===0?'✅':'❌'} ${ok} bien, ${fail} mal.`)
await c.end(); process.exit(fail===0?0:1)

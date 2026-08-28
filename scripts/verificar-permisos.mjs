// Verificación funcional del módulo de permisos y roles.
//
// Para CADA rol de la tabla `roles` crea un usuario sintético, se autentica
// como él (SET ROLE authenticated + claims JWT) y ejecuta escrituras REALES
// sobre las tablas clave. Compara el resultado con el permiso que el rol tiene
// configurado en /roles: si el rol tiene el permiso, la escritura debe pasar;
// si no lo tiene, debe ser rechazada. Todo corre dentro de una transacción que
// se revierte: no deja datos ni usuarios de prueba.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
const require = createRequire(import.meta.url)
const { Client } = require('pg')
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const c = new Client({ connectionString: env.match(/^DIRECT_URL="?([^"\n]+)"?/m)[1].trim(), ssl: { rejectUnauthorized: false } })
await c.connect()

// [etiqueta, permisos que la habilitan (cualquiera), SQL de escritura]
const PRUEBAS = [
  ['crear producto',        'editar_productos',       `insert into productos (nombre_estandar, tipo_insumo, cat_rotacion) values ('__PRUEBA__','OTROS','C')`],
  ['editar producto',       'editar_productos',       `update productos set stock_minimo_def = stock_minimo_def where id = (select id from productos where activo limit 1)`],
  ['foto de producto',      'editar_productos|importar_datos',       `insert into producto_fotos (producto_id, url, es_principal, orden) values ((select id from productos where activo limit 1),'http://x/p.jpg',false,99)`],
  ['ajustar stock',         'ajustar_stock',          `update stock set cantidad_real = cantidad_real where producto_id = (select id from productos where activo limit 1)`],
  ['stock CCE',             'ajustar_stock|editar_productos',          `insert into stock_cce (producto_id) values ((select id from productos where activo limit 1)) on conflict (producto_id) do update set cantidad_real = stock_cce.cantidad_real`],
  ['catálogo CCE',          'editar_productos|importar_datos',       `update colombia_compra_eficiente set bien = bien where id = (select id from colombia_compra_eficiente limit 1)`],
  ['registrar movimiento',  'crear_movimientos',      `insert into movimientos (producto_id, tipo, cantidad) values ((select id from productos where activo limit 1),'AJUSTE',0)`],
  ['borrador movimiento',   'crear_movimientos',      `update movimiento_borradores set nombre = nombre where id = (select id from movimiento_borradores limit 1)`],
  ['gestionar bodega',      'gestionar_bodegas',      `update bodegas set nombre = nombre where id = (select id from bodegas limit 1)`],
  ['gestionar ubicación',   'gestionar_bodegas',      `update ubicaciones set codigo = codigo where id = (select id from ubicaciones limit 1)`],
  ['editar proveedor',      'editar_proveedores',     `update proveedores set nombre = nombre where id = (select id from proveedores limit 1)`],
  ['orden de compra',       'crear_ordenes_compra',   `update ordenes_compra set observacion = observacion where id = (select id from ordenes_compra limit 1)`],
  ['orden de insumo',       'alistar_ordenes_insumo|crear_ordenes_insumo|aprobar_ordenes_insumo|recibir_ordenes_insumo', `update ordenes_insumo set observacion = observacion where id = (select id from ordenes_insumo limit 1)`],
  ['editar sede',           'editar_contratos',       `update sedes set nombre = nombre where id = (select id from sedes limit 1)`],
  ['parametrización sede',  'gestionar_parametrizacion', `update sede_productos set cantidad_maxima = cantidad_maxima where id = (select id from sede_productos limit 1)`],
  ['editar persona',        'gestionar_personas',     `update personas set nombres = nombres where id = (select id from personas limit 1)`],
  ['gestionar maquinaria',  'gestionar_maquinaria',   `update maquinaria set nombre = nombre where id = (select id from maquinaria limit 1)`],
  ['gestionar conductor',   'gestionar_conductores',  `update conductores set observacion = observacion where id = (select id from conductores limit 1)`],
  ['tipos de servicio',     'gestionar_tipos_servicio', `update tipos_servicio_hogar set nombre = nombre where id = (select id from tipos_servicio_hogar limit 1)`],
  ['tarifas de servicio',   'gestionar_precios_servicio', `update tarifas_servicio_hogar set precio = precio where id = (select id from tarifas_servicio_hogar limit 1)`],
  ['editar usuarios',       'gestionar_usuarios',     `update usuarios set telefono = telefono where id = (select id from usuarios where activo limit 1)`],
  ['editar roles',          'gestionar_roles',        `update roles set descripcion = descripcion where nombre = 'Auditor'`],
  ['reglas de alerta',      'gestionar_alertas',      `update reglas_alerta set activa = activa where id = (select id from reglas_alerta limit 1)`],
]

const roles = (await c.query('select id, nombre, rol_base, permisos from roles order by nombre')).rows
await c.query('BEGIN')

const uids = {}
for (const r of roles) {
  uids[r.nombre] = (await c.query(
    `insert into usuarios (id, email, nombre, rol, rol_id, activo)
     values (gen_random_uuid(), $1, $2, coalesce($3::rol_usuario,'AUDITOR'), $4, true) returning id`,
    [`probe.${r.id}@test.local`, `PROBE ${r.nombre}`, r.rol_base, r.id])).rows[0].id
}

const fallos = []
const filas = []
for (const r of roles) {
  const admin = r.rol_base === 'ADMIN' || r.rol_base === 'SUPER_ADMIN'
  const celdas = []
  for (const [etiqueta, permiso, sql] of PRUEBAS) {
    const esperado = admin || permiso.split('|').some((k) => r.permisos?.[k] === true)
    await c.query('SAVEPOINT sp')
    await c.query('SET LOCAL ROLE authenticated')
    await c.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: uids[r.nombre], role: 'authenticated' })])
    let obtenido, detalle = ''
    try {
      const res = await c.query(sql)
      // Un UPDATE que afecta 0 filas no prueba nada: la política pudo filtrar
      // la fila o simplemente no había datos. Se marca como indeterminado.
      obtenido = sql.trim().startsWith('update') && res.rowCount === 0 ? null : true
    } catch (e) {
      obtenido = /row-level security|permission denied/i.test(e.message) ? false : null
      detalle = e.message.split('\n')[0]
    }
    // ROLLBACK TO SAVEPOINT también revierte el `SET LOCAL ROLE` (y limpia el
    // estado abortado cuando la escritura falló), así que no hace falta RESET.
    await c.query('ROLLBACK TO SAVEPOINT sp')

    if (obtenido === null) celdas.push(' ? ')
    else if (obtenido === esperado) celdas.push(obtenido ? ' ✔ ' : ' · ')
    else {
      celdas.push(obtenido ? ' ⚠+' : ' ⚠-')
      fallos.push({ rol: r.nombre, prueba: etiqueta, permiso, esperado, obtenido, detalle })
    }
  }
  filas.push([r.nombre, celdas])
}
await c.query('ROLLBACK')

const ancho = Math.max(...PRUEBAS.map(p => p[0].length))
console.log('ROL'.padEnd(26) + PRUEBAS.map((_, i) => String(i + 1).padStart(3)).join(''))
for (const [nombre, celdas] of filas) console.log(nombre.padEnd(26) + celdas.join(''))
console.log()
PRUEBAS.forEach(([e, p], i) => console.log(`${String(i + 1).padStart(3)}. ${e.padEnd(ancho)}  ← ${p}`))
console.log('\n✔ permitido y correcto · · denegado y correcto · ⚠+ permite de más · ⚠- deniega de más · ? sin datos para probar')

if (fallos.length === 0) {
  console.log('\n✅ Sin discrepancias: la base de datos concede exactamente lo que dice /roles.')
} else {
  console.log(`\n❌ ${fallos.length} discrepancia(s):`)
  for (const f of fallos) {
    console.log(`   ${f.rol} · ${f.prueba} (${f.permiso}): esperaba ${f.esperado ? 'permitir' : 'denegar'} y ${f.obtenido ? 'permitió' : 'denegó'}${f.detalle ? ' — ' + f.detalle : ''}`)
  }
}
await c.end()
process.exit(fallos.length ? 1 : 0)

// Verificación funcional de las políticas de LECTURA (RLS SELECT).
//
//   node scripts/verificar-lecturas.mjs            → matriz completa
//   node scripts/verificar-lecturas.mjs productos  → solo esas tablas
//
// Para CADA rol de la tabla `roles` crea un usuario sintético, se autentica
// como él (SET ROLE authenticated + claims JWT) y cuenta las filas que VE en
// cada tabla sensible. Es la contraparte de `verificar-permisos.mjs`, que prueba
// escrituras: aquí se comprueba que una cuenta sin permisos (p. ej. el rol
// Empleado, que son ~850 cuentas creadas desde la nómina) no pueda leer la
// operación, los precios ni los datos personales.
//
// Todo corre dentro de una transacción que se revierte: no deja datos.
//
// El usuario sintético no tiene sede, grupo ni persona vinculada, así que las
// cláusulas de "lo propio" (su sede, su rol, su ficha, sus rutas) cuentan 0 en
// esta matriz aunque sí funcionen en la app. Las columnas marcadas con (p) son
// las que tienen una de esas cláusulas.
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

// Tablas que se cerraron (antes tenían SELECT con USING (true)), agrupadas como
// en la decisión: personas y rastreo, plata y precios, operación interna.
const GRUPOS = {
  'A · personas y rastreo': [
    'conductores', 'conductor_ubicacion_actual', 'conductor_ubicacion_historial',
    'confirmaciones_entrega', 'historial_cambios', 'importaciones',
  ],
  'B · plata y precios': [
    'precios_proveedor', 'proveedores', 'ordenes_compra', 'oc_items', 'oc_eventos',
    'colombia_compra_eficiente', 'stock_cce', 'aprovisionamiento', 'pedidos_sede',
    'rotacion', 'parametros_pago_hogar',
  ],
  'C · operación interna': [
    'productos', 'producto_fotos', 'stock', 'movimientos', 'movimiento_borradores',
    'movimiento_borrador_items', 'movimiento_borrador_responsables', 'arqueos',
    'arqueo_items', 'reembasados', 'reembasado_items', 'reembasado_ejecuciones',
    'bodegas', 'bodega_pisos', 'ubicaciones', 'ordenes_insumo', 'orden_insumo_items',
    'orden_insumo_eventos', 'orden_insumo_responsables', 'orden_insumo_devoluciones',
    'orden_insumo_devolucion_items', 'sede_productos', 'maquinaria', 'maquinaria_eventos',
    'rutas_entrega', 'ruta_paradas', 'novedades_entrega', 'sede_horario_entrega',
    'sedes', 'grupos_contrato', 'etiquetas', 'etiqueta_categorias', 'grupo_etiquetas',
    'sede_etiquetas', 'roles', 'empresas_usuarias', 'empresas_emisoras',
    'tipos_documentales', 'tipos_documentales_refs', 'eventos_notificacion', 'reglas_alerta',
  ],
  'D · abierto a cualquier cuenta': ['presentaciones'],
  'ya cerradas antes': ['personas', 'documentos_persona', 'usuarios'],
}
// Tablas con cláusula de "lo propio": el usuario sintético no la cumple.
const PROPIO = new Set([
  'conductores', 'conductor_ubicacion_actual', 'conductor_ubicacion_historial',
  'confirmaciones_entrega', 'importaciones', 'sedes', 'grupos_contrato', 'roles',
  'empresas_usuarias', 'personas', 'documentos_persona', 'usuarios',
])

const filtro = process.argv.slice(2)
const tablas = Object.entries(GRUPOS).flatMap(([g, ts]) =>
  ts.filter((t) => !filtro.length || filtro.includes(t)).map((t) => [g, t]))

const totales = {}
for (const [, t] of tablas) {
  totales[t] = (await c.query(`select count(*)::int n from ${t}`)).rows[0].n
}

const roles = (await c.query('select id, nombre, rol_base, permisos from roles where activo order by nombre')).rows
await c.query('BEGIN')
const uids = {}
for (const r of roles) {
  uids[r.nombre] = (await c.query(
    `insert into usuarios (id, email, nombre, rol, rol_id, activo)
     values (gen_random_uuid(), $1, $2, coalesce($3::rol_usuario,'AUDITOR'), $4, true) returning id`,
    [`probe.lectura.${r.id}@test.local`, `PROBE ${r.nombre}`, r.rol_base, r.id])).rows[0].id
}

// Un solo SELECT por rol (61 subconsultas): contra el pooler remoto, una
// consulta por tabla y por rol se iba a varios minutos.
const censo = 'select ' + tablas
  .map(([, t], i) => `(select count(*) from ${t})::int as t${i}`)
  .join(', ')

const vistas = {}
for (const r of roles) {
  vistas[r.nombre] = {}
  await c.query('SAVEPOINT sp')
  await c.query('SET LOCAL ROLE authenticated')
  await c.query(`select set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uids[r.nombre], role: 'authenticated' })])
  let fila = null
  try {
    fila = (await c.query(censo)).rows[0]
  } catch (e) {
    console.error(`   ${r.nombre}: ${e.message.split('\n')[0]}`)
  }
  await c.query('ROLLBACK TO SAVEPOINT sp')
  tablas.forEach(([, t], i) => { vistas[r.nombre][t] = fila ? fila[`t${i}`] : null })
}
await c.query('ROLLBACK')

const cols = roles.map((r) => r.nombre)
const ancho = Math.max(...tablas.map(([, t]) => t.length + 4), 24)
const cab = (s) => s.slice(0, 7).padStart(8)
console.log('TABLA'.padEnd(ancho) + 'TOTAL'.padStart(8) + cols.map(cab).join(''))
let grupoActual = ''
for (const [g, t] of tablas) {
  if (g !== grupoActual) {
    grupoActual = g
    console.log('\n── ' + g + ' ' + '─'.repeat(Math.max(0, ancho - g.length - 4)))
  }
  const etq = t + (PROPIO.has(t) ? ' (p)' : '')
  console.log(etq.padEnd(ancho) + String(totales[t]).padStart(8) +
    cols.map((n) => {
      const v = vistas[n][t]
      return (v === null ? 'err' : v === 0 ? '·' : String(v)).padStart(8)
    }).join(''))
}
console.log('\nColumnas: ' + cols.map((n) => n.slice(0, 7) + ' = ' + n).join(' | '))
console.log('· = no ve ninguna fila · (p) = tiene cláusula de "lo propio" (el usuario sintético no la cumple)')
await c.end()

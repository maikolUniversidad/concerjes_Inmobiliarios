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

const ANA = 'ce7c08c4-c84e-4783-96f9-6684ea6853e6'
async function comoUsuario(uid, fn) {
  await c.query('BEGIN')
  await c.query(`SET LOCAL ROLE authenticated`)
  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: uid, role: 'authenticated' })])
  try { await fn() } finally { await c.query('ROLLBACK') }
}
async function probar(label, sql, params = []) {
  try { const r = await c.query(sql, params); console.log(`  ✅ ${label}`, r.rowCount !== null ? `(${r.rowCount} filas)` : '') }
  catch (e) { console.log(`  ❌ ${label} → ${e.message}`) }
}

console.log('── Ana María (Bodeguero) ──')
await comoUsuario(ANA, async () => {
  await probar('auth_permiso(editar_productos)', "select public.auth_permiso('editar_productos') as v").catch(()=>{})
  const r = await c.query("select public.auth_permiso('editar_productos') ep, public.auth_permiso('gestionar_roles') gr, public.auth_permiso('ajustar_stock') as ast")
  console.log('  permisos:', r.rows[0])
  await probar('INSERT producto', "insert into productos (nombre_estandar, tipo_insumo, cat_rotacion) values ('TEST PERMISOS', 'OTROS', 'C')")
  await probar('UPDATE producto', "update productos set stock_minimo_def = stock_minimo_def where activo = true and id = (select id from productos where activo limit 1)")
  await probar('UPDATE stock', "update stock set cantidad_real = cantidad_real where producto_id = (select id from productos where activo limit 1)")
  await probar('INSERT producto_fotos', "insert into producto_fotos (producto_id, url, es_principal, orden) values ((select id from productos where activo limit 1), 'http://x/t.jpg', false, 99)")
  await probar('UPDATE stock_cce', "insert into stock_cce (producto_id) values ((select id from productos where activo limit 1)) on conflict (producto_id) do update set cantidad_real = excluded.cantidad_real")
  await probar('CREAR ROL (debe fallar)', "insert into roles (nombre, permisos, activo) values ('HACK', '{}'::jsonb, true)")
  await probar('BORRAR ROL (debe fallar)', "delete from roles where nombre = 'Auditor'")
  await probar('CREAR USUARIO (debe fallar)', "insert into usuarios (id, email, nombre, rol) values (gen_random_uuid(), 'x@x.com', 'X', 'ADMIN')")
})
await c.end()

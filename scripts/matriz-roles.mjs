// Matriz rol × permiso, agrupada como se ve en /roles.
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

// Catálogo con sus grupos, leído del archivo fuente
const src = readFileSync(join(root, 'apps/inventario/lib/permisos.ts'), 'utf8')
const grupos = []
for (const m of src.matchAll(/grupo: '([^']+)',\s*\n\s*permisos: \[([\s\S]*?)\n\s*\],/g)) {
  grupos.push({ nombre: m[1], claves: [...m[2].matchAll(/key: '([a-z_]+)'/g)].map(k => k[1]) })
}

const roles = (await c.query(
  'select nombre, rol_base, permisos from roles where activo order by nombre')).rows
const usuarios = Object.fromEntries((await c.query(
  `select r.nombre, count(u.id) n from roles r
   left join usuarios u on u.rol_id = r.id and u.activo group by 1`)).rows.map(r => [r.nombre, r.n]))
await c.end()

const ABBR = {
  'Super Administrador': 'SAD', 'Administrador': 'ADM', 'Gerencia': 'GER',
  'Supervisor de Conserjería': 'SUP', 'Coordinador': 'COO', 'Coordinador de Compras': 'CMP',
  'Bodeguero': 'BOD', 'Conserje': 'CJE', 'Operador de Sede': 'OPS',
  'Conductor': 'CND', 'Auditor': 'AUD',
}
const orden = Object.keys(ABBR).filter(n => roles.some(r => r.nombre === n))
const porNombre = Object.fromEntries(roles.map(r => [r.nombre, r]))

console.log('Usuarios activos por rol:')
console.log('  ' + orden.map(n => `${ABBR[n]}=${usuarios[n] ?? 0}`).join('  '))
console.log('  ' + orden.map(n => `${ABBR[n]} ${n}`).join(' · '))
console.log()

const cab = orden.map(n => ABBR[n].padStart(4)).join('')
for (const g of grupos) {
  console.log(`\n── ${g.nombre} ${'─'.repeat(Math.max(0, 44 - g.nombre.length))}${cab}`)
  for (const k of g.claves) {
    const fila = orden.map(n => {
      const r = porNombre[n]
      if (r.rol_base === 'ADMIN' || r.rol_base === 'SUPER_ADMIN') return '   *'
      return r.permisos?.[k] === true ? '   ✔' : '   ·'
    }).join('')
    console.log('  ' + k.padEnd(43) + fila)
  }
}
console.log('\n✔ activo · · inactivo · * acceso total implícito (rol base ADMIN/SUPER_ADMIN)')

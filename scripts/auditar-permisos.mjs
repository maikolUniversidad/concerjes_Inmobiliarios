// Auditoría ESTÁTICA del módulo de permisos y roles.
//
//   node scripts/auditar-permisos.mjs
//
// Cruza las cuatro fuentes de verdad y reporta incoherencias:
//   CAT  catálogo `apps/inventario/lib/permisos.ts` (lo que se ve en /roles)
//   APP  pantallas y acciones que exigen la clave (requirePermiso/faltaPermiso/puede)
//   RLS  políticas de la base de datos que la exigen (auth_permiso/_any)
//   BD   roles que la tienen activa
//
// Además lista pantallas del dashboard sin guard, ítems de menú sin `permiso`
// y archivos de acciones que escriben sin verificar nada.
//
// La contraparte funcional (¿la BD concede lo que dice /roles?) es
// `scripts/verificar-permisos.mjs`.
import { createRequire } from 'module'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, dirname, relative, sep } from 'path'
import { fileURLToPath } from 'url'
const require = createRequire(import.meta.url)
const { Client } = require('pg')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const base = join(root, 'apps/inventario')

function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next') continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(f)) out.push(p)
  }
  return out
}
const rel = f => relative(root, f).split(sep).join('/')

// ── Claves exigidas por la app ──────────────────────────────────────────────
const archivos = [...walk(join(base, 'app')), ...walk(join(base, 'components')), ...walk(join(base, 'lib'))]
const app = new Set()
for (const f of archivos) {
  const txt = readFileSync(f, 'utf8')
  for (const re of [
    /(?:requirePermiso|useRequierePermiso|puede)\(\s*'([a-z_]+)'/g,
    /faltaPermiso\(((?:\s*'[a-z_]+'\s*,?)+)\)/g,
    /permiso:\s*'([a-z_]+)'/g,
  ]) {
    for (const m of txt.matchAll(re)) {
      for (const k of m[1].matchAll(/[a-z][a-z_]{3,}/g)) app.add(k[0])
    }
  }
}

// ── Claves exigidas por las políticas RLS ───────────────────────────────────
const env = readFileSync(join(root, '.env.local'), 'utf8')
const c = new Client({ connectionString: env.match(/^DIRECT_URL="?([^"\n]+)"?/m)[1].trim(), ssl: { rejectUnauthorized: false } })
await c.connect()
const pols = (await c.query(`
  select coalesce(qual,'') || ' ' || coalesce(with_check,'') as e
  from pg_policies where schemaname in ('public', 'storage')`)).rows
const rls = new Set()
for (const r of pols) {
  for (const m of r.e.matchAll(/auth_permiso(?:_any)?\(([\s\S]*?)\)/g))
    for (const k of m[1].replace(/::text(\[\])?/g, '').matchAll(/[a-z][a-z_]{3,}/g))
      if (k[0] !== 'array') rls.add(k[0])
}
const enRoles = new Set((await c.query(
  `select distinct k from roles, lateral jsonb_object_keys(permisos) k`)).rows.map(r => r.k))
const rolesBD = (await c.query(
  'select nombre, rol_base, permisos from roles where activo order by nombre')).rows
await c.end()

const cat = new Set(readFileSync(join(base, 'lib/permisos.ts'), 'utf8').match(/key: '[a-z_]+'/g).map(s => s.slice(6, -1)))
// Módulos de conserjería aún por construir: las claves ya existen en /roles a
// propósito, para poder configurar los roles antes de conectar las pantallas.
const PENDIENTES = new Set([
  'ver_pqrs', 'gestionar_pqrs', 'ver_no_conformes', 'gestionar_no_conformes',
  'ver_contratos_conserjeria', 'ver_panel_gerencia',
])

const todas = [...new Set([...cat, ...rls, ...app, ...enRoles])].sort()

console.log('### CLAVES DE PERMISO CON INCOHERENCIAS ###')
console.log('CLAVE'.padEnd(36), 'CAT APP RLS  BD   problema')
let n = 0
for (const x of todas) {
  if (PENDIENTES.has(x)) continue
  const problemas = []
  if (!cat.has(x)) problemas.push('NO está en el catálogo → no se puede otorgar desde /roles')
  else if (!app.has(x) && !rls.has(x)) problemas.push('nadie la exige → otorgarla no hace nada')
  if (cat.has(x) && !enRoles.has(x)) problemas.push('ningún rol la tiene activa')
  if (!problemas.length) continue
  n++
  console.log(x.padEnd(36), [cat.has(x), app.has(x), rls.has(x), enRoles.has(x)].map(b => b ? ' ✔ ' : ' · ').join(' '), problemas.join(' + '))
}
console.log(`    ${n} de ${todas.length} claves\n`)

// ── Dependencias entre permisos ─────────────────────────────────────────────
// Un permiso de acción es inútil (o falla) sin su lectura correspondiente:
// cerrar un arqueo aplica un ajuste de stock, gestionar reembasado necesita ver
// la pantalla, el cargue masivo de personas vive en /importar, etc.
const IMPLICA = {
  editar_productos: ['ver_productos'],
  ajustar_stock: ['ver_stock'],
  crear_movimientos: ['ver_movimientos'],
  eliminar_movimientos: ['ver_movimientos'],
  // cerrar un arqueo aplica AJUSTE de stock: sin ajustar_stock el cierre falla
  realizar_arqueo: ['ver_arqueo', 'ver_stock', 'ajustar_stock'],
  gestionar_bodegas: ['ver_bodegas'],
  gestionar_reembasado: ['ver_reembasado'],
  gestionar_maquinaria: ['ver_maquinaria'],
  editar_aprovisionamiento: ['ver_aprovisionamiento'],
  editar_contratos: ['ver_contratos'],
  gestionar_parametrizacion: ['ver_parametrizacion'],
  editar_proveedores: ['ver_proveedores'],
  crear_ordenes_compra: ['ver_ordenes_compra'],
  crear_ordenes_insumo: ['ver_ordenes_insumo'],
  aprobar_ordenes_insumo: ['ver_ordenes_insumo'],
  recibir_ordenes_insumo: ['ver_ordenes_insumo'],
  alistar_ordenes_insumo: ['ver_ordenes_insumo', 'ver_alistamiento'],
  subir_documentos: ['ver_documentos'],
  gestionar_usuarios: ['ver_usuarios'],
  // el cargue masivo de personas vive en /importar, que exige importar_datos
  importar_personas: ['importar_datos', 'ver_personas'],
  gestionar_personas: ['ver_personas'],
  gestionar_empresas_usuarias: ['ver_empresas_usuarias'],
  gestionar_documentos_rrhh: ['ver_documentos_rrhh'],
  gestionar_tipos_documentales: ['ver_documentos_rrhh'],
  gestionar_postulaciones: ['ver_postulaciones'],
  gestionar_pqrs: ['ver_pqrs'],
  gestionar_no_conformes: ['ver_no_conformes'],
  gestionar_contratos_conserjeria: ['ver_contratos_conserjeria'],
  gestionar_solicitudes_hogar: ['ver_servicios_hogar'],
  gestionar_agenda_hogar: ['ver_servicios_hogar'],
  gestionar_tipos_servicio: ['ver_servicios_hogar'],
  gestionar_precios_servicio: ['ver_servicios_hogar'],
  gestionar_pagos_hogar: ['ver_servicios_hogar', 'ver_pagos_hogar'],
  parametrizar_pagos_hogar: ['ver_servicios_hogar', 'ver_pagos_hogar'],
  gestionar_flujos_notificacion: ['ver_flujos_notificacion'],
  gestionar_conductores: ['ver_logistica'],
  gestionar_rutas: ['ver_logistica'],
  ver_ubicacion_conductores: ['ver_logistica'],
  gestionar_horarios_entrega: ['ver_logistica'],
  ver_monitoreo_entregas: ['ver_logistica'],
  gestionar_novedades_entrega: ['ver_logistica', 'ver_novedades_entrega'],
  ver_rutas_conductor: ['ver_logistica'],
  actualizar_gps_conductor: ['ver_rutas_conductor'],
  confirmar_entrega_conductor: ['ver_rutas_conductor'],
  reportar_novedad_conductor: ['ver_rutas_conductor', 'ver_novedades_entrega'],
  gestionar_alertas: ['ver_notificaciones'],
  editar_configuracion: ['ver_configuracion'],
  gestionar_integraciones: ['ver_configuracion'],
}

const incoherentes = []
for (const r of rolesBD) {
  if (r.rol_base === 'ADMIN' || r.rol_base === 'SUPER_ADMIN') continue  // acceso total
  const faltan = new Set()
  for (let pasada = 0; pasada < 4; pasada++) {
    for (const [accion, deps] of Object.entries(IMPLICA)) {
      if (r.permisos?.[accion] !== true && !faltan.has(accion)) continue
      for (const d of deps) if (r.permisos?.[d] !== true) faltan.add(d)
    }
  }
  if (faltan.size) incoherentes.push([r.nombre, [...faltan].sort()])
}
console.log('### ROLES CON PERMISOS QUE NO PUEDEN FUNCIONAR ###')
for (const [rol, ks] of incoherentes) console.log(`    ${rol}: falta ${ks.join(', ')}`)
console.log(`    ${incoherentes.length} de ${rolesBD.length} roles
`)

// ── Pantallas sin guard ─────────────────────────────────────────────────────
// `/dashboard`, `/perfil` y `/carnet` son personales: cualquier usuario
// autenticado debe poder abrirlas, por eso no exigen permiso.
const PERSONALES = ['dashboard/page.tsx', 'perfil/page.tsx', 'carnet/page.tsx']
const paginas = walk(join(base, 'app')).filter(f => /[\\/]page\.tsx$/.test(f) && f.includes('(dashboard)'))
const layoutProtege = {}
for (const l of walk(join(base, 'app')).filter(f => /[\\/]layout\.tsx$/.test(f))) {
  if (/requirePermiso\(/.test(readFileSync(l, 'utf8'))) layoutProtege[dirname(l)] = true
}
const cubierta = f => {
  let d = dirname(f)
  while (d.length > base.length) { if (layoutProtege[d]) return true; d = dirname(d) }
  return false
}
const sinGuard = paginas.filter(f =>
  !/requirePermiso\(|useRequierePermiso\(|getPermisosUsuario\(/.test(readFileSync(f, 'utf8')) &&
  !cubierta(f) && !PERSONALES.some(p => rel(f).endsWith(p)))
console.log('### PANTALLAS DEL DASHBOARD SIN CONTROL DE ACCESO ###')
sinGuard.forEach(f => console.log('   ', rel(f)))
console.log(`    ${sinGuard.length} de ${paginas.length} pantallas\n`)

// ── Menú ────────────────────────────────────────────────────────────────────
const nav = readFileSync(join(base, 'components/layout/navigation.ts'), 'utf8')
const items = [...nav.matchAll(/\{[^{}]*href:\s*'([^']+)'[^{}]*\}/g)]
const sinPermiso = items.filter(m => !/permiso:/.test(m[0])).map(m => m[1])
  .filter(h => !['/dashboard', '/carnet', '/perfil'].includes(h))
console.log('### ÍTEMS DE MENÚ VISIBLES PARA TODOS ###')
sinPermiso.forEach(h => console.log('   ', h))
console.log(`    ${sinPermiso.length} de ${items.length} ítems\n`)

// ── Acciones ────────────────────────────────────────────────────────────────
// `app/api/registro/*` es el portal público de aspirantes: no exige permisos.
const acciones = walk(join(base, 'app'))
  .filter(f => /actions\.ts$/.test(f) || /route\.ts$/.test(f))
  .filter(f => !rel(f).includes('api/registro/'))
const sinCheck = acciones.filter(f => {
  const txt = readFileSync(f, 'utf8')
  return (/\.(insert|update|upsert|delete)\(|\.rpc\(/.test(txt)) &&
         !/requirePermiso\(|faltaPermiso\(|getPermisosUsuario\(|\.puede\(/.test(txt)
})
console.log('### ACCIONES QUE ESCRIBEN SIN VERIFICAR PERMISO ###')
sinCheck.forEach(f => console.log('   ', rel(f)))
console.log(`    ${sinCheck.length} de ${acciones.length} archivos`)

process.exit(n || incoherentes.length || sinGuard.length || sinPermiso.length || sinCheck.length ? 1 : 0)

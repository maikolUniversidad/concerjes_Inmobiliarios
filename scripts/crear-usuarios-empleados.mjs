// =============================================================================
// Cuentas de plataforma para la planta activa
// =============================================================================
// A cada colaborador ACTIVO le crea su acceso con el rol «Empleado»:
//
//   usuario     = <cédula>@conserje.local   (o su correo de contacto si lo hay)
//   contraseña  = la cédula
//
// Es la misma convención que ya usa el formulario de Gestión Humana
// (`app/api/gestion-humana/personas/route.ts`), para no tener dos maneras de
// entrar a lo mismo. En /login se puede escribir solo la cédula: el correo
// sintético lo resuelve `app/api/auth/resolver-acceso`.
//
// ⚠️ La contraseña es la cédula, que no es un secreto: aparece en la nómina, en
// los informes y en el carnet. Sirve para el primer ingreso, no como clave. Cada
// cuenta queda marcada con `debe_cambiar_password` para poder exigir el cambio,
// y el rol «Empleado» es de mínimo privilegio (rol_base AUDITOR, permisos {}):
// aunque alguien adivine una cédula, no alcanza nada de la operación.
//
// Idempotente: si la cuenta ya existe no la vuelve a crear ni le cambia la
// contraseña; solo se asegura del rol y del enlace con la ficha.
//
// Uso:
//   node scripts/crear-usuarios-empleados.mjs --dry-run
//   node scripts/crear-usuarios-empleados.mjs --limit 5
//   node scripts/crear-usuarios-empleados.mjs
// =============================================================================
import { createRequire } from 'module'
import { readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const LIMITE = (() => {
  const i = args.indexOf('--limit')
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : null
})()
const CONCURRENCIA = 8

const env = readFileSync(join(root, '.env.local'), 'utf8')
const leer = (k) => (env.match(new RegExp(`^${k}="?([^"\n]+)"?`, 'm')) || [])[1]?.trim()
const SUPABASE_URL = leer('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = leer('SUPABASE_SERVICE_ROLE_KEY')
const DIRECT_URL = leer('DIRECT_URL')
if (!SUPABASE_URL || !SERVICE_KEY || !DIRECT_URL) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o DIRECT_URL en .env.local')
  process.exit(1)
}

// Misma regla que loginEmailFor() en la API de Gestión Humana.
const correoLogin = (email, documento) => {
  const e = (email ?? '').trim().toLowerCase()
  if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e
  return `${String(documento).trim().replace(/[^a-z0-9]/gi, '')}@conserje.local`
}
// Auth exige mínimo 6 caracteres; las cédulas cortas se rellenan con ceros.
const clave = (documento) => {
  const d = String(documento).trim()
  return d.length >= 6 ? d : d.padStart(6, '0')
}

async function crearEnAuth(persona) {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: persona.login_email,
      password: clave(persona.documento),
      email_confirm: true,
      user_metadata: {
        nombre: persona.nombre_completo || `${persona.nombres} ${persona.apellidos}`.trim(),
        documento: persona.documento,
        origen: 'PLANTA_NOMINA',
        debe_cambiar_password: true,
      },
    }),
  })
  if (r.ok) return { estado: 'CREADA' }
  const cuerpo = await r.text()
  // Ya registrada: no es un error, es el caso de volver a correr el script.
  if (/already|registered|exists|duplicate/i.test(cuerpo)) return { estado: 'YA_EXISTIA' }
  return { estado: 'ERROR', error: `${r.status} ${cuerpo.slice(0, 200)}` }
}

const cliente = new Client({ connectionString: DIRECT_URL, ssl: { rejectUnauthorized: false } })
await cliente.connect()

const { rows: rol } = await cliente.query(`SELECT id FROM roles WHERE nombre = 'Empleado'`)
if (!rol.length) {
  console.error('No existe el rol «Empleado». Aplica supabase/migrations/20260910000000_planta_personal.sql primero.')
  process.exit(1)
}
const ROL_EMPLEADO = rol[0].id

const { rows: pendientes } = await cliente.query(`
  SELECT p.id, p.documento, p.nombres, p.apellidos, p.nombre_completo, p.email, p.telefono
    FROM personas p
   WHERE p.estado = 'ACTIVO'
     AND p.usuario_id IS NULL
     AND EXISTS (SELECT 1 FROM persona_vinculaciones v
                  WHERE v.persona_id = p.id AND v.estado = 'ACTIVA')
   ORDER BY p.documento
   ${LIMITE ? `LIMIT ${Number(LIMITE)}` : ''}
`)

for (const p of pendientes) p.login_email = correoLogin(p.email, p.documento)

// Choque de correos: dos fichas que resolverían al mismo login se dejan por
// fuera antes de tocar Auth, porque la segunda fallaría a medias.
const porCorreo = new Map()
for (const p of pendientes) porCorreo.set(p.login_email, [...(porCorreo.get(p.login_email) || []), p])
const duplicados = [...porCorreo.values()].filter((g) => g.length > 1).flat()
const aCrear = pendientes.filter((p) => porCorreo.get(p.login_email).length === 1)

console.log('── Cuentas de empleado ──────────────────────────────────')
console.log('Activos con vinculación sin cuenta :', pendientes.length)
console.log('Correos de login en choque         :', duplicados.length)
console.log('A procesar                         :', aCrear.length)
if (DRY) {
  console.log('\nEjemplos:')
  for (const p of aCrear.slice(0, 5)) {
    console.log(`  ${p.documento}  →  ${p.login_email}  /  ${clave(p.documento)}`)
  }
  console.log('\n(--dry-run: no se creó ninguna cuenta)')
  await cliente.end()
  process.exit(0)
}

// ── Alta en Auth ─────────────────────────────────────────────────────────────
const resultados = { CREADA: 0, YA_EXISTIA: 0, ERROR: 0 }
const errores = []
let hechos = 0

async function trabajador(cola) {
  while (cola.length) {
    const p = cola.pop()
    const r = await crearEnAuth(p)
    resultados[r.estado]++
    if (r.estado === 'ERROR') errores.push({ documento: p.documento, email: p.login_email, error: r.error })
    if (++hechos % 50 === 0) process.stdout.write(`  ${hechos}/${aCrear.length}\r`)
  }
}
const cola = [...aCrear]
await Promise.all(Array.from({ length: CONCURRENCIA }, () => trabajador(cola)))
console.log(`  ${hechos}/${aCrear.length}`)

// ── Rol y enlace con la ficha ────────────────────────────────────────────────
// Se hace en SQL de una sola pasada: el trigger `handle_new_user` ya creó la
// fila en `usuarios`, aquí solo se le pone nombre, rol y el amarre a la persona.
await cliente.query('BEGIN')
const { rowCount: rolesPuestos } = await cliente.query(`
  UPDATE usuarios u
     SET rol_id = $1,
         nombre = COALESCE(NULLIF(p.nombre_completo,''), u.nombre),
         telefono = COALESCE(u.telefono, p.telefono),
         activo = true
    FROM personas p
   WHERE u.email = lower(p.documento || '@conserje.local')
     AND p.estado = 'ACTIVO'
     AND (u.rol_id IS NULL OR u.rol_id = $1)
`, [ROL_EMPLEADO])

const { rowCount: enlazados } = await cliente.query(`
  UPDATE personas p
     SET usuario_id = u.id, updated_at = NOW()
    FROM usuarios u
   WHERE u.email = lower(p.documento || '@conserje.local')
     AND p.usuario_id IS NULL
`)
await cliente.query('COMMIT')

console.log('\nCuentas creadas          :', resultados.CREADA)
console.log('Ya existían              :', resultados.YA_EXISTIA)
console.log('Errores                  :', resultados.ERROR)
console.log('Rol «Empleado» asignado  :', rolesPuestos)
console.log('Fichas enlazadas a cuenta:', enlazados)

if (errores.length || duplicados.length) {
  // Lleva documentos y correos: fuera del repo.
  const ruta = join(tmpdir(), 'usuarios-empleados-pendientes.json')
  writeFileSync(ruta, JSON.stringify({ errores, duplicados }, null, 2))
  console.log('\n⚠️ Quedaron casos por revisar en', ruta)
}

await cliente.end()

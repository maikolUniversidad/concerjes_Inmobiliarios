/**
 * Crea (o repone) el CLIENTE DEMO del portal de Servicios del Hogar, con datos
 * de ejemplo para recorrer el flujo completo: agendar → seguimiento → calificar
 * → pagar.
 *
 * Todo lo que crea queda marcado con el correo del demo y con el prefijo DEMO
 * en las notas, así que se puede borrar sin tocar datos reales:
 *   node scripts/crear-cliente-demo.mjs --borrar
 *
 * Uso:
 *   node --use-system-ca scripts/crear-cliente-demo.mjs
 */
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const leer = (clave) => {
  const m = env.match(new RegExp(`^${clave}="?([^"\\n]+)"?`, 'm'))
  return m ? m[1].trim() : null
}

const SUPABASE_URL = leer('NEXT_PUBLIC_SUPABASE_URL')
const SERVICE_KEY = leer('SUPABASE_SERVICE_ROLE_KEY')
const DB_URL = leer('DIRECT_URL')
if (!SUPABASE_URL || !SERVICE_KEY || !DB_URL) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / DIRECT_URL en .env.local')
  process.exit(1)
}

const EMAIL = 'comprador.demo@conserjesinmobiliarios.com'
const PASSWORD = 'Demo-Conserjes-2026'
const NOMBRE = 'Camila Restrepo'
const borrar = process.argv.includes('--borrar')

const auth = (ruta, opciones = {}) =>
  fetch(`${SUPABASE_URL}/auth/v1/admin/${ruta}`, {
    ...opciones,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opciones.headers ?? {}),
    },
  })

async function buscarUsuario() {
  const r = await auth(`users?page=1&per_page=200`)
  if (!r.ok) throw new Error(`No se pudo listar usuarios: ${r.status} ${await r.text()}`)
  const j = await r.json()
  return (j.users ?? []).find((u) => u.email?.toLowerCase() === EMAIL) ?? null
}

const db = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
await db.connect()

try {
  let usuario = await buscarUsuario()

  if (borrar) {
    if (!usuario) { console.log('No existe el cliente demo; nada que borrar.'); process.exit(0) }
    await db.query(`DELETE FROM cobros_servicio_hogar WHERE cliente_id = $1`, [usuario.id])
    await db.query(`DELETE FROM solicitudes_servicio_hogar WHERE cliente_id = $1`, [usuario.id])
    await db.query(`DELETE FROM notificaciones_cliente WHERE cliente_id = $1`, [usuario.id])
    await db.query(`DELETE FROM correo_saliente WHERE para = $1`, [EMAIL])
    const r = await auth(`users/${usuario.id}`, { method: 'DELETE' })
    console.log(r.ok ? '🗑️  Cliente demo eliminado.' : `No se pudo borrar el usuario: ${await r.text()}`)
    process.exit(0)
  }

  // ── 1) Usuario de autenticación ────────────────────────────────────────────
  if (usuario) {
    await auth(`users/${usuario.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password: PASSWORD, email_confirm: true }),
    })
    console.log('↻ Usuario demo ya existía: contraseña restablecida.')
  } else {
    const r = await auth('users', {
      method: 'POST',
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: NOMBRE },
      }),
    })
    if (!r.ok) throw new Error(`No se pudo crear el usuario: ${r.status} ${await r.text()}`)
    usuario = await r.json()
    console.log('✅ Usuario demo creado.')
  }

  const uid = usuario.id

  // ── 2) Perfil de cliente + dirección ───────────────────────────────────────
  await db.query(
    `INSERT INTO clientes (id, nombre, email, telefono, documento, proveedor)
     VALUES ($1,$2,$3,'3105558899','1020304050','email')
     ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, email = EXCLUDED.email,
       telefono = EXCLUDED.telefono`,
    [uid, NOMBRE, EMAIL]
  )

  await db.query(`DELETE FROM direcciones_cliente WHERE cliente_id = $1`, [uid])
  await db.query(
    `INSERT INTO direcciones_cliente (cliente_id, etiqueta, direccion, ciudad, barrio, es_principal)
     VALUES ($1,'Casa','Calle 127 # 15-40, Apto 802','Bogotá','Santa Bárbara', true)`,
    [uid]
  )

  // ── 3) Servicios de ejemplo ────────────────────────────────────────────────
  await db.query(`DELETE FROM cobros_servicio_hogar WHERE cliente_id = $1`, [uid])
  await db.query(`DELETE FROM solicitudes_servicio_hogar WHERE cliente_id = $1`, [uid])
  await db.query(`DELETE FROM notificaciones_cliente WHERE cliente_id = $1`, [uid])

  const { rows: [aseo] } = await db.query(
    `SELECT t.id AS tipo_id, (SELECT id FROM tarifas_servicio_hogar WHERE tipo_id = t.id ORDER BY duracion_horas LIMIT 1) AS tarifa_id
       FROM tipos_servicio_hogar t WHERE t.nombre = 'Aseo Regular' LIMIT 1`)
  const { rows: [profunda] } = await db.query(
    `SELECT t.id AS tipo_id, (SELECT id FROM tarifas_servicio_hogar WHERE tipo_id = t.id ORDER BY duracion_horas LIMIT 1) AS tarifa_id
       FROM tipos_servicio_hogar t WHERE t.nombre = 'Limpieza Profunda' LIMIT 1`)

  const base = {
    cliente_nombre: NOMBRE, cliente_email: EMAIL, cliente_telefono: '3105558899',
    cliente_direccion: 'Calle 127 # 15-40, Apto 802', cliente_ciudad: 'Bogotá', cliente_barrio: 'Santa Bárbara',
  }

  // (a) Servicio COMPLETADO y ya calificado → historial + reseña.
  const { rows: [completado] } = await db.query(
    `INSERT INTO solicitudes_servicio_hogar
       (numero, cliente_id, cliente_nombre, cliente_email, cliente_telefono, cliente_direccion,
        cliente_ciudad, cliente_barrio, tipo_id, tarifa_id, frecuencia, fecha_deseada, hora_inicio,
        estado, precio_cotizado, confirmado_at, completado_at, calificacion, comentario_calificacion, notas)
     VALUES ('SH-DEMO-0001',$1,$2,$3,$4,$5,$6,$7,$8,$9,'UNICA', CURRENT_DATE - 6, '09:00',
             'COMPLETADA', 95000, NOW() - INTERVAL '7 days', NOW() - INTERVAL '6 days',
             5, 'Excelente servicio, muy puntuales.', 'DEMO — datos de ejemplo')
     RETURNING id`,
    [uid, base.cliente_nombre, base.cliente_email, base.cliente_telefono, base.cliente_direccion,
     base.cliente_ciudad, base.cliente_barrio, aseo?.tipo_id ?? null, aseo?.tarifa_id ?? null])

  // (b) Servicio CONFIRMADO próximo → seguimiento en curso.
  const { rows: [confirmado] } = await db.query(
    `INSERT INTO solicitudes_servicio_hogar
       (numero, cliente_id, cliente_nombre, cliente_email, cliente_telefono, cliente_direccion,
        cliente_ciudad, cliente_barrio, tipo_id, tarifa_id, frecuencia, fecha_deseada, hora_inicio,
        estado, precio_cotizado, confirmado_at, notas)
     VALUES ('SH-DEMO-0002',$1,$2,$3,$4,$5,$6,$7,$8,$9,'UNICA', CURRENT_DATE + 3, '08:00',
             'CONFIRMADA', 140000, NOW(), 'DEMO — datos de ejemplo')
     RETURNING id`,
    [uid, base.cliente_nombre, base.cliente_email, base.cliente_telefono, base.cliente_direccion,
     base.cliente_ciudad, base.cliente_barrio, profunda?.tipo_id ?? null, profunda?.tarifa_id ?? null])

  await db.query(
    `INSERT INTO agenda_servicio_hogar (solicitud_id, fecha, hora_inicio, hora_fin, estado)
     VALUES ($1, CURRENT_DATE + 3, '08:00', '12:00', 'PROGRAMADO')`, [confirmado.id])

  // ── 4) Cuentas de cobro ────────────────────────────────────────────────────
  // (a) Ya pagada → historial de pagos.
  const { rows: [{ siguiente_numero_cobro: n1 }] } = await db.query('SELECT siguiente_numero_cobro()')
  const { rows: [cobroPagado] } = await db.query(
    `INSERT INTO cobros_servicio_hogar
       (numero, solicitud_id, cliente_id, cliente_nombre, cliente_email, concepto, subtotal, total, saldo,
        estado, fecha_emision, fecha_vencimiento, notas)
     VALUES ($1,$2,$3,$4,$5,'Aseo Regular · Medio día',95000,95000,95000,'EMITIDO',
             CURRENT_DATE - 7, CURRENT_DATE - 4, 'DEMO — datos de ejemplo')
     RETURNING id`,
    [n1, completado.id, uid, NOMBRE, EMAIL])
  await db.query(
    `INSERT INTO cobro_items_hogar (cobro_id, descripcion, cantidad, valor_unitario, orden)
     VALUES ($1,'Aseo Regular (Medio día) — 4 horas',1,95000,0)`, [cobroPagado.id])
  const { rows: [metodoTransf] } = await db.query(`SELECT id, nombre FROM metodos_pago_hogar WHERE codigo='TRANSFERENCIA'`)
  await db.query(
    `INSERT INTO pagos_hogar (cobro_id, cliente_id, metodo_id, metodo_nombre, monto, referencia,
                              fecha_pago, origen, estado, verificado_at)
     VALUES ($1,$2,$3,$4,95000,'DEMO-8891', CURRENT_DATE - 6, 'CLIENTE','VERIFICADO', NOW())`,
    [cobroPagado.id, uid, metodoTransf?.id ?? null, metodoTransf?.nombre ?? 'Transferencia bancaria'])

  // (b) Pendiente → es la que se puede pagar desde el portal.
  const { rows: [{ siguiente_numero_cobro: n2 }] } = await db.query('SELECT siguiente_numero_cobro()')
  const { rows: [cobroPendiente] } = await db.query(
    `INSERT INTO cobros_servicio_hogar
       (numero, solicitud_id, cliente_id, cliente_nombre, cliente_email, concepto, subtotal, total, saldo,
        estado, fecha_emision, fecha_vencimiento, notas)
     VALUES ($1,$2,$3,$4,$5,'Limpieza Profunda · Medio día',140000,140000,140000,'EMITIDO',
             CURRENT_DATE, CURRENT_DATE + 3, 'DEMO — pagable desde el portal')
     RETURNING id, numero`,
    [n2, confirmado.id, uid, NOMBRE, EMAIL])
  await db.query(
    `INSERT INTO cobro_items_hogar (cobro_id, descripcion, cantidad, valor_unitario, orden) VALUES
       ($1,'Limpieza Profunda (Medio día) — 4 horas',1,130000,0),
       ($1,'Insumos y productos especializados',1,10000,1)`, [cobroPendiente.id])

  console.log('\n─────────────────────────────────────────────')
  console.log(' USUARIO COMPRADOR DE PRUEBA')
  console.log('─────────────────────────────────────────────')
  console.log(' Portal   : /portal/ingresar')
  console.log(' Correo   :', EMAIL)
  console.log(' Clave    :', PASSWORD)
  console.log(' Cliente  :', NOMBRE, '·', uid)
  console.log(' Servicios: SH-DEMO-0001 (completado) · SH-DEMO-0002 (confirmado)')
  console.log(' Cobros   :', n1, '(pagado) ·', n2, '(pendiente $140.000)')
  console.log('─────────────────────────────────────────────\n')
} finally {
  await db.end()
}

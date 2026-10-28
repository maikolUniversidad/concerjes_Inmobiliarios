// Pruebas de la F7 del módulo de Puntos QR (planes preventivos y órdenes de
// trabajo) contra la base REAL, dentro de una transacción que se revierte: no
// deja ni una fila.
//
// Qué comprueba:
//   1. el ESQUEMA: el enum en orden de ciclo de vida, `maquinaria_id` ya
//      nullable, las cuatro tablas nuevas, las 33 columnas del ticket, que las
//      tres de SLA sean GENERADAS (no escribibles), los cuatro CHECK, las
//      cuatro vistas con `security_invoker`, y que `mant_transicion` y
//      `mant_reportar` hayan quedado en UNA sola firma — si quedara la vieja
//      como sobrecarga, Supabase fallaría con «could not choose the best
//      candidate function»;
//   2. que `mant_puede_participar()` NO se tocó y que la lectura de tickets sí
//      filtra por contrato: el módulo de maquinaria tenía que quedar igual;
//   3. que `mant_notificar` usa LEFT JOIN. Con el INNER de antes, una orden de
//      activo emitía la notificación con payload vacío EN SILENCIO;
//   4. `mant_vence_sla` sobre el calendario de días hábiles de PQRS;
//   5. el autómata ENTERO de una orden de trabajo: del plan al cierre, con la
//      visita en sitio, los materiales que mueven stock de verdad y la firma
//      del cliente;
//   6. que el ticket de maquinaria propia NO cambió de reglas: sigue sin
//      contrato ni plazos, su hoja de vida sigue recibiendo eventos y el camino
//      corto de siempre sigue cerrando sin aprobación del cliente.
//
// Uso: NODE_OPTIONS=--use-system-ca node scripts/probar-puntos-qr-f7.mjs
import { createRequire } from 'module'
import { leerEnv } from './_env.mjs'
const require = createRequire(import.meta.url)
const { Client } = require('pg')

const c = new Client({ connectionString: leerEnv('DIRECT_URL'), ssl: { rejectUnauthorized: false } })
await c.connect()

let fallos = 0
const ok = (t) => console.log(`   ok   ${t}`)
const mal = (t, e) => { fallos++; console.log(`   MAL  ${t}${e ? ' → ' + e : ''}`) }

/**
 * Comprueba que algo se RECHAZA, con el mensaje correcto. Va envuelto en un
 * SAVEPOINT: en Postgres una excepción aborta la transacción entera, así que
 * sin esto la primera comprobación de rechazo tumbaría todas las siguientes.
 */
async function rechaza(titulo, sql, params, regex) {
  await c.query('SAVEPOINT sp')
  try {
    await c.query(sql, params)
    await c.query('RELEASE SAVEPOINT sp')
    mal(`${titulo} — NO se rechazó`)
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT sp')
    if (regex.test(e.message)) ok(titulo)
    else mal(titulo, e.message)
  }
}

async function espera(titulo, sql, predicado) {
  try {
    const r = await c.query(sql)
    const v = r.rows[0] ? Object.values(r.rows[0])[0] : null
    if (predicado(v, r.rows)) ok(`${titulo} (${JSON.stringify(v)})`)
    else mal(`${titulo} (${JSON.stringify(v)})`)
  } catch (e) { mal(titulo, e.message) }
}

console.log('\n── 1. ESQUEMA ──────────────────────────────────────────────')

await espera('enum en orden de ciclo de vida', `
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname='estado_ticket_mant'`,
  (v) => v === 'ABIERTO,RECIBIDO,ACEPTADO,EN_CAMINO,EN_SITIO,EN_PROCESO,EN_ESPERA,RESUELTO,APROBADO_CLIENTE,CERRADO,CANCELADO')

await espera('maquinaria_id ya es nullable', `
  SELECT is_nullable FROM information_schema.columns
   WHERE table_name='mantenimiento_tickets' AND column_name='maquinaria_id'`,
  (v) => v === 'YES')

await espera('las 4 tablas nuevas existen', `
  SELECT count(*)::int FROM information_schema.tables
   WHERE table_schema='public'
     AND table_name IN ('mant_planes','mant_plan_tareas','mant_plan_materiales','mant_materiales')`,
  (v) => v === 4)

await espera('columnas nuevas del ticket', `
  SELECT count(*)::int FROM information_schema.columns
   WHERE table_name='mantenimiento_tickets' AND column_name IN
     ('activo_id','grupo_id','plan_id','visita_id','pqrs_id','proveedor_id','origen',
      'aceptado_at','en_camino_at','en_sitio_at','en_sitio_modo','respondido_at',
      'sla_respuesta_vence_at','sla_solucion_vence_at','sla_respuesta_cumplido','sla_solucion_cumplido',
      'aprobado_cliente_at','aprobado_cliente_nombre','aprobado_cliente_cargo','aprobado_tacito',
      'aprobacion_vence_at','firma_tecnico_id','firma_cliente_id','costo_mano_obra','costo_materiales',
      'reabierto_de','reaperturas','medidor_id','medidor_valor','activo_codigo','activo_nombre',
      'estado_activo_reportado','estado_activo_final')`,
  (v) => v === 33)

await espera('las 3 columnas de SLA son generadas', `
  SELECT count(*)::int FROM information_schema.columns
   WHERE table_name='mantenimiento_tickets' AND is_generated='ALWAYS'
     AND column_name IN ('respondido_at','sla_respuesta_cumplido','sla_solucion_cumplido')`,
  (v) => v === 3)

await espera('CHECK de objeto (equipo o activo, no ambos)', `
  SELECT count(*)::int FROM pg_constraint
   WHERE conname IN ('mant_tickets_objeto','mant_tickets_origen','mant_tickets_en_sitio_modo','mant_tickets_estado_activo')`,
  (v) => v === 4)

await espera('ronda_visitas.ticket_id', `
  SELECT count(*)::int FROM information_schema.columns
   WHERE table_name='ronda_visitas' AND column_name='ticket_id'`,
  (v) => v === 1)

await espera('las 4 vistas nuevas', `
  SELECT count(*)::int FROM information_schema.views
   WHERE table_schema='public' AND table_name IN
     ('vw_mant_plan_objetivos','vw_mant_plan_proximos','vw_mant_backlog','vw_mant_indicadores')`,
  (v) => v === 4)

await espera('las vistas heredan la RLS (security_invoker)', `
  SELECT count(*)::int FROM pg_class
   WHERE relname IN ('vw_mant_plan_objetivos','vw_mant_plan_proximos','vw_mant_backlog','vw_mant_indicadores')
     AND reloptions @> ARRAY['security_invoker=true']`,
  (v) => v === 4)

await espera('las RPC nuevas y las reescritas', `
  SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname IN
     ('mant_vence_sla','mant_abrir_visita','mant_material_registrar','mant_material_quitar',
      'mant_aprobar_tacitos','mant_evento_objeto','mant_archivo_puede_ver')`,
  (v) => v === 7)

await espera('mant_transicion quedó en UNA sola firma (sin sobrecarga)', `
  SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mant_transicion'`,
  (v) => v === 1)

await espera('mant_reportar quedó en UNA sola firma (sin sobrecarga)', `
  SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mant_reportar'`,
  (v) => v === 1)

await espera('mant_puede_participar NO se tocó', `
  SELECT pg_get_functiondef(p.oid) LIKE '%auth_permiso_any%' AND pg_get_functiondef(p.oid) NOT LIKE '%auth_grupos%'
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mant_puede_participar'`,
  (v) => v === true)

await espera('la lectura de tickets ya filtra por contrato', `
  SELECT qual FROM pg_policies WHERE tablename='mantenimiento_tickets' AND policyname='mant_tickets_read'`,
  (v) => typeof v === 'string' && v.includes('auth_grupos') && v.includes('grupo_id IS NULL'))

await espera('mant_notificar usa LEFT JOIN (ya no falla en silencio)', `
  SELECT pg_get_functiondef(p.oid) NOT LIKE '%JOIN maquinaria m ON m.id = t.maquinaria_id%'
     AND pg_get_functiondef(p.oid) LIKE '%LEFT JOIN maquinaria%'
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='mant_notificar'`,
  (v) => v === true)

await espera('RLS activa en las 4 tablas nuevas', `
  SELECT count(*)::int FROM pg_class
   WHERE relname IN ('mant_planes','mant_plan_tareas','mant_plan_materiales','mant_materiales')
     AND relrowsecurity`,
  (v) => v === 4)

await espera('plantilla genérica MANT-OT publicada con sus 5 pasos', `
  SELECT count(*)::int FROM ronda_plantilla_pasos s
    JOIN ronda_plantillas p ON p.id = s.plantilla_id
   WHERE p.codigo='MANT-OT' AND p.estado='PUBLICADA' AND p.grupo_id IS NULL`,
  (v) => v === 5)

await espera('grupo_sla.aprobacion_dias_habiles', `
  SELECT count(*)::int FROM information_schema.columns
   WHERE table_name='grupo_sla' AND column_name='aprobacion_dias_habiles'`,
  (v) => v === 1)

await espera('los dos roles de mantenimiento ven el activo y pueden abrir la visita', `
  SELECT count(*)::int FROM roles
   WHERE nombre IN ('Técnico de Mantenimiento','Jefe de Mantenimiento')
     AND permisos->>'ver_activos_ronda' = 'true'
     AND permisos->>'ejecutar_rondas'   = 'true'`,
  (v) => v === 2)

console.log('\n── 2. PLAZOS DE SLA ───────────────────────────────────────')

await espera('tiempo corrido: 4 h son 4 h', `
  SELECT public.mant_vence_sla('2026-10-28 10:00:00-05'::timestamptz, 4, false)
         = '2026-10-28 14:00:00-05'::timestamptz`,
  (v) => v === true)

// Viernes 30/oct 09:00 + 24 h hábiles = 3 jornadas de 8 h: viernes, lunes y
// martes. Debe caer el martes 3 a las 17:00, saltando el fin de semana.
await espera('horas hábiles: 24 h saltan el fin de semana', `
  SELECT to_char(public.mant_vence_sla('2026-10-30 09:00:00-05'::timestamptz, 24, true)
                 AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI DY')`,
  (v) => typeof v === 'string' && v.startsWith('2026-11-03 17:00'))

await espera('horas hábiles: 8 h no salen del mismo día', `
  SELECT to_char(public.mant_vence_sla('2026-10-28 08:00:00-05'::timestamptz, 8, true)
                 AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI')`,
  (v) => v === '2026-10-28 16:00')

await espera('sin horas pactadas no hay plazo', `SELECT public.mant_vence_sla(now(), NULL, true) IS NULL`,
  (v) => v === true)

console.log('\n── 3. COMPORTAMIENTO (BEGIN … ROLLBACK) ───────────────────')

await c.query('BEGIN')
try {
  // Un usuario real con permisos de jefe de mantenimiento, para que las RPC
  // (que validan con auth_permiso) se comporten como en la app.
  const { rows: us } = await c.query(`
    SELECT u.id, u.nombre FROM usuarios u
     WHERE u.rol IN ('SUPER_ADMIN','ADMIN') AND u.activo
     ORDER BY u.created_at LIMIT 1`)
  if (us.length === 0) throw new Error('no hay usuario administrador para la prueba')
  const uid = us[0].id

  await c.query(`SELECT set_config('request.jwt.claims', $1, true)`,
    [JSON.stringify({ sub: uid, role: 'authenticated' })])

  // La visita de F4 exige saber QUIÉN la hizo: `ronda_actor()` busca la persona
  // vinculada a la cuenta. Se vincula una dentro de la transacción (y se
  // revierte) para poder probar la ejecución en sitio de punta a punta.
  const { rows: pe } = await c.query(`
    UPDATE personas SET usuario_id = $1
     WHERE id = (SELECT id FROM personas WHERE usuario_id IS NULL ORDER BY created_at LIMIT 1)
    RETURNING id`, [uid])
  if (pe.length === 1) ok('cuenta vinculada a una persona para la prueba de campo')
  else mal('no se pudo vincular una persona: la visita no se podrá abrir')

  // Datos de muestra: contrato real, sede real, zona, punto, activo con punto.
  const { rows: g } = await c.query(`SELECT id FROM grupos_contrato WHERE codigo='CA' LIMIT 1`)
  const grupo = g[0].id
  const { rows: s } = await c.query(`SELECT id FROM sedes WHERE grupo_id=$1 AND activo LIMIT 1`, [grupo])
  const sede = s[0].id

  const { rows: pt } = await c.query(`
    INSERT INTO ronda_puntos (grupo_id, sede_id, codigo, nombre, estado, exige_geocerca)
    VALUES ($1, $2, 'PC-F7-PRUEBA', 'Punto de prueba F7', 'ACTIVO', false)
    RETURNING id`, [grupo, sede])
  const punto = pt[0].id

  const { rows: at } = await c.query(`SELECT id, nombre FROM activo_tipos ORDER BY nombre LIMIT 1`)
  const tipo = at[0].id

  const { rows: ac } = await c.query(`
    INSERT INTO activos (grupo_id, sede_id, punto_id, activo_tipo_id, codigo, nombre, criticidad, estado)
    VALUES ($1, $2, $3, $4, 'AC-F7TEST', 'Activo de prueba F7', 'ALTA', 'OPERATIVO')
    RETURNING id, codigo`, [grupo, sede, punto, tipo])
  const activo = ac[0].id
  ok(`datos de muestra: contrato CA, punto y activo ${ac[0].codigo}`)

  // ANS del contrato, para que el ticket nazca con plazos.
  await c.query(`
    INSERT INTO grupo_sla (grupo_id, servicio, prioridad, respuesta_horas, solucion_horas, horas_habiles, aprobacion_dias_habiles)
    VALUES ($1, 'MANTENIMIENTO', 'ALTA', 4, 24, false, 2)
    ON CONFLICT (grupo_id, servicio, prioridad) DO UPDATE
      SET respuesta_horas = 4, solucion_horas = 24, horas_habiles = false, aprobacion_dias_habiles = 2`, [grupo])

  // ── 3.1 Un plan y su preventivo ──────────────────────────────────────────
  const { rows: pl } = await c.query(`
    INSERT INTO mant_planes (nombre, grupo_id, activo_tipo_id, frecuencia_tipo, frecuencia_valor,
                             anticipacion_dias, obligatorio_normativo, normativa, prioridad, created_by)
    VALUES ('Revisión trimestral de prueba', $1, $2, 'MESES', 3, 15, true, 'NTC-PRUEBA', 'ALTA', $3)
    RETURNING id, codigo`, [grupo, tipo, uid])
  ok(`plan creado: ${pl[0].codigo}`)

  const { rows: obj } = await c.query(
    `SELECT objeto_codigo, proximo_el, ticket_abierto_id FROM vw_mant_plan_proximos WHERE plan_id=$1`, [pl[0].id])
  if (obj.length >= 1) ok(`la vista expande el plan a ${obj.length} objeto(s); próximo el ${obj[0].proximo_el?.toISOString?.().slice(0, 10)}`)
  else mal('la vista no expandió el plan a ningún objeto')

  const { rows: gen } = await c.query(`SELECT public.mant_generar_preventivos(400) AS n`)
  const { rows: tk } = await c.query(`
    SELECT id, numero, estado::text, tipo, origen, grupo_id, activo_id, activo_codigo,
           sla_respuesta_vence_at, sla_solucion_vence_at, programado_para, prioridad
      FROM mantenimiento_tickets WHERE plan_id=$1`, [pl[0].id])
  if (tk.length === 1) ok(`el plan generó 1 orden (${tk[0].numero}), de ${gen[0].n} en total`)
  else mal(`el plan generó ${tk.length} órdenes (se esperaba 1)`)
  const t = tk[0]
  if (t.activo_id === activo && t.maquinaria_id == null) ok('la orden cuelga del activo, no de maquinaria')
  if (t.origen === 'PLAN') ok("origen = 'PLAN'"); else mal(`origen = ${t.origen}`)
  if (t.grupo_id === grupo) ok('grupo_id se derivó del activo'); else mal('grupo_id no se derivó')
  if (t.activo_codigo === 'AC-F7TEST') ok('activo_codigo desnormalizado'); else mal('sin activo_codigo')
  if (t.sla_respuesta_vence_at && t.sla_solucion_vence_at) ok('nació con los dos plazos de SLA del contrato')
  else mal('nació sin plazos de SLA')

  // Idempotencia: volver a generar no duplica.
  const { rows: gen2 } = await c.query(`SELECT public.mant_generar_preventivos(400) AS n`)
  const { rows: tk2 } = await c.query(`SELECT count(*)::int AS n FROM mantenimiento_tickets WHERE plan_id=$1`, [pl[0].id])
  if (tk2[0].n === 1) ok('volver a generar no duplica la orden abierta')
  else mal(`volver a generar dejó ${tk2[0].n} órdenes`)

  // ── 3.2 El autómata completo de la OT ────────────────────────────────────
  await c.query(`SELECT public.mant_transicion($1, 'ASIGNAR', NULL, NULL, NULL, NULL, NULL, $2)`, [t.id, uid])
  await c.query(`SELECT public.mant_transicion($1, 'ACEPTAR')`, [t.id])
  let e = (await c.query(`SELECT estado::text, aceptado_at, respondido_at, sla_respuesta_cumplido FROM mantenimiento_tickets WHERE id=$1`, [t.id])).rows[0]
  if (e.estado === 'ACEPTADO' && e.aceptado_at) ok('ACEPTAR → ACEPTADO con su marca de tiempo')
  else mal(`ACEPTAR dejó ${e.estado}`)
  if (e.respondido_at && e.sla_respuesta_cumplido === true) ok('respondido_at y el SLA de respuesta se calcularon solos')
  else mal(`respondido_at=${e.respondido_at} sla=${e.sla_respuesta_cumplido}`)

  await c.query(`SELECT public.mant_transicion($1, 'SALIR')`, [t.id])
  e = (await c.query(`SELECT estado::text, en_camino_at FROM mantenimiento_tickets WHERE id=$1`, [t.id])).rows[0]
  if (e.estado === 'EN_CAMINO' && e.en_camino_at) ok('SALIR → EN_CAMINO'); else mal(`SALIR dejó ${e.estado}`)

  // EN_SITIO solo por la apertura de la visita: no hay acción que lo ponga.
  await rechaza('no existe una acción EN_SITIO: solo lo escribe el escaneo',
    `SELECT public.mant_transicion($1, 'EN_SITIO')`, [t.id], /Acción desconocida/)

  // Abrir la visita (sin QR → apertura manual, que exige motivo).
  await rechaza('la apertura manual sin motivo se rechaza con su explicación',
    `SELECT public.mant_abrir_visita($1, gen_random_uuid(), NULL, NULL, NULL, NULL, NULL, 'MANUAL')`,
    [t.id], /apertura manual/)

  const { rows: av } = await c.query(`
    SELECT public.mant_abrir_visita($1, gen_random_uuid(), NULL, NULL, NULL, NULL,
                                    'QR de la placa ilegible', 'MANUAL') AS r`, [t.id])
  const vis = av[0].r
  e = (await c.query(`SELECT estado::text, en_sitio_at, en_sitio_modo, visita_id FROM mantenimiento_tickets WHERE id=$1`, [t.id])).rows[0]
  if (e.estado === 'EN_SITIO' && e.en_sitio_modo === 'MANUAL' && e.visita_id === vis.visita_id)
    ok(`la visita ${vis.visita_numero} dejó la orden EN_SITIO (modo MANUAL, distinguible en el informe)`)
  else mal(`la apertura dejó estado=${e.estado} modo=${e.en_sitio_modo}`)

  const { rows: vt } = await c.query(`SELECT ticket_id FROM ronda_visitas WHERE id=$1`, [vis.visita_id])
  if (vt[0].ticket_id === t.id) ok('la visita sabe de qué orden viene (ronda_visitas.ticket_id)')
  else mal('la visita quedó sin ticket_id')

  // ── 3.3 Materiales que mueven stock de verdad ────────────────────────────
  await c.query(`SELECT public.mant_transicion($1, 'INICIAR')`, [t.id])
  const { rows: pr } = await c.query(`
    SELECT p.id, p.nombre_estandar, s.cantidad_real, s.cantidad_disp
      FROM productos p JOIN stock s ON s.producto_id = p.id
     WHERE s.cantidad_real >= 5 ORDER BY s.cantidad_real DESC LIMIT 1`)
  if (pr.length === 0) throw new Error('no hay producto con existencias para la prueba')
  const antes = Number(pr[0].cantidad_real)

  const { rows: mat } = await c.query(
    `SELECT public.mant_material_registrar($1, $2, 2, 15000) AS id`, [t.id, pr[0].id])
  const { rows: desp } = await c.query(`SELECT cantidad_real, cantidad_disp FROM stock WHERE producto_id=$1`, [pr[0].id])
  if (Number(desp[0].cantidad_real) === antes - 2)
    ok(`el material movió stock de verdad: ${antes} → ${desp[0].cantidad_real}`)
  else mal(`el stock pasó de ${antes} a ${desp[0].cantidad_real} (se esperaba ${antes - 2})`)

  const { rows: mm } = await c.query(`
    SELECT m.movimiento_id, m.costo_total, mo.tipo::text AS tipo, mo.cantidad
      FROM mant_materiales m LEFT JOIN movimientos mo ON mo.id = m.movimiento_id
     WHERE m.id=$1`, [mat[0].id])
  if (mm[0].movimiento_id && mm[0].tipo === 'SALIDA' && Number(mm[0].cantidad) === 2)
    ok('el consumo quedó con su movimiento de SALIDA (pasó por registrar_movimiento)')
  else mal(`el movimiento quedó ${JSON.stringify(mm[0])}`)

  const { rows: cst } = await c.query(`SELECT costo_materiales, costo FROM mantenimiento_tickets WHERE id=$1`, [t.id])
  if (Number(cst[0].costo_materiales) === 30000) ok('costo_materiales lo mantiene la base (2 × 15.000)')
  else mal(`costo_materiales = ${cst[0].costo_materiales}`)

  // Sin existencias se rechaza, contra el físico.
  await rechaza('consumir más de lo que hay se rechaza contra cantidad_real',
    `SELECT public.mant_material_registrar($1, $2, 999999, NULL)`, [t.id, pr[0].id], /No hay existencias/)

  // Devolver repone.
  await c.query(`SELECT public.mant_material_quitar($1, 'no se usó')`, [mat[0].id])
  const { rows: rep } = await c.query(`SELECT cantidad_real FROM stock WHERE producto_id=$1`, [pr[0].id])
  if (Number(rep[0].cantidad_real) === antes) ok(`devolver el material repuso el stock: ${rep[0].cantidad_real}`)
  else mal(`tras devolver, el stock quedó en ${rep[0].cantidad_real}`)
  // Se vuelve a cargar para seguir la prueba con costo.
  await c.query(`SELECT public.mant_material_registrar($1, $2, 2, 15000)`, [t.id, pr[0].id])

  // ── 3.4 Resolver, firma del cliente, aprobar y cerrar ────────────────────
  await c.query(`SELECT public.mant_transicion($1, 'RESOLVER', NULL, NULL, 'Rodamiento gastado',
                                               'Se cambió el rodamiento y se probó', 80000, NULL, 'OPERATIVO')`, [t.id])
  e = (await c.query(`
    SELECT estado::text, resuelto_at, aprobacion_vence_at, estado_activo_final, costo_mano_obra,
           costo_materiales, costo, sla_solucion_cumplido
      FROM mantenimiento_tickets WHERE id=$1`, [t.id])).rows[0]
  if (e.estado === 'RESUELTO' && e.estado_activo_final === 'OPERATIVO') ok('RESOLVER → RESUELTO y el activo queda OPERATIVO')
  else mal(`RESOLVER dejó estado=${e.estado} activo=${e.estado_activo_final}`)
  if (e.aprobacion_vence_at) ok(`la aprobación tácita tiene plazo: ${e.aprobacion_vence_at.toISOString().slice(0, 10)}`)
  else mal('se resolvió sin plazo de aprobación tácita')
  if (Number(e.costo) === 110000) ok('costo = mano de obra + materiales (80.000 + 30.000)')
  else mal(`costo = ${e.costo} (mano ${e.costo_mano_obra}, materiales ${e.costo_materiales})`)
  if (e.sla_solucion_cumplido === true) ok('el SLA de solución se calculó solo')

  const { rows: ea } = await c.query(`SELECT estado FROM activos WHERE id=$1`, [activo])
  if (ea[0].estado === 'OPERATIVO') ok('la ficha del activo se movió con la orden (no la de maquinaria)')

  // Cerrar sin aprobación del cliente: prohibido en una OT de cliente.
  await rechaza('una OT de cliente NO se cierra sin la aprobación del cliente',
    `SELECT public.mant_transicion($1, 'CERRAR')`, [t.id], /apruebe/)

  // La firma del cliente, por el motor de F4.
  const { rows: fr } = await c.query(`
    SELECT (public.ronda_firmar($1, 'CLIENTE', 'TRAZO', 'rondas/firmas/prueba-f7.png',
                                'Quien recibe por el cliente', NULL, NULL, NULL, NULL, NULL)).id AS id`,
    [vis.visita_id])
  // NO se le pasa la firma a propósito: la RPC tiene que encontrarla sola
  // desde la visita de la orden, que es lo que hace la pantalla.
  await c.query(`SELECT public.mant_transicion($1, 'APROBAR_CLIENTE', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                                               'Quien recibe por el cliente', 'Jefe de mantenimiento del edificio')`, [t.id])
  e = (await c.query(`
    SELECT estado::text, aprobado_cliente_at, aprobado_cliente_nombre, aprobado_cliente_cargo,
           firma_cliente_id, aprobado_tacito FROM mantenimiento_tickets WHERE id=$1`, [t.id])).rows[0]
  if (e.estado === 'APROBADO_CLIENTE' && e.firma_cliente_id === fr[0].id && e.aprobado_tacito === false)
    ok(`APROBAR_CLIENTE → APROBADO_CLIENTE y la firma de la visita se adjuntó SOLA (cargo: ${e.aprobado_cliente_cargo})`)
  else mal(`la aprobación dejó ${JSON.stringify(e)}`)

  await c.query(`SELECT public.mant_transicion($1, 'CERRAR')`, [t.id])
  e = (await c.query(`SELECT estado::text, cerrado_at FROM mantenimiento_tickets WHERE id=$1`, [t.id])).rows[0]
  if (e.estado === 'CERRADO' && e.cerrado_at) ok('CERRAR → CERRADO después de la aprobación')
  else mal(`CERRAR dejó ${e.estado}`)

  // ── 3.5 Aprobación tácita ────────────────────────────────────────────────
  const { rows: t2 } = await c.query(`
    SELECT (public.mant_reportar('CORRECTIVO','ALTA','Falla de prueba para la tácita', NULL, $1)->>'id')::uuid AS id`, [activo])
  await c.query(`SELECT public.mant_transicion($1, 'ASIGNAR', NULL, NULL, NULL, NULL, NULL, $2)`, [t2[0].id, uid])
  await c.query(`SELECT public.mant_transicion($1, 'RESOLVER', NULL, NULL, NULL, 'Arreglado', NULL)`, [t2[0].id])
  // Se vence el plazo a mano, que es lo que hará el tiempo.
  await c.query(`UPDATE mantenimiento_tickets SET aprobacion_vence_at = now() - interval '1 day' WHERE id=$1`, [t2[0].id])
  const { rows: tac } = await c.query(`SELECT public.mant_aprobar_tacitos() AS n`)
  e = (await c.query(`SELECT estado::text, aprobado_tacito FROM mantenimiento_tickets WHERE id=$1`, [t2[0].id])).rows[0]
  if (e.estado === 'APROBADO_CLIENTE' && e.aprobado_tacito === true)
    ok(`la aprobación tácita movió ${tac[0].n} orden(es) y queda marcada como tácita`)
  else mal(`la tácita dejó ${JSON.stringify(e)}`)

  // ── 3.6 El ticket de maquinaria propia NO cambió de reglas ───────────────
  const { rows: mq } = await c.query(`SELECT id, codigo FROM maquinaria WHERE activo AND estado <> 'BAJA' LIMIT 1`)
  const { rows: t3 } = await c.query(`
    SELECT (public.mant_reportar('CORRECTIVO','MEDIA','Falla de prueba de maquinaria', $1)->>'id')::uuid AS id`, [mq[0].id])
  e = (await c.query(`SELECT estado::text, grupo_id, sla_respuesta_vence_at, activo_id FROM mantenimiento_tickets WHERE id=$1`, [t3[0].id])).rows[0]
  if (e.grupo_id === null && e.sla_respuesta_vence_at === null && e.activo_id === null)
    ok('el ticket de maquinaria propia sigue sin contrato y sin plazos (no se inventó un contrato interno)')
  else mal(`el ticket de maquinaria quedó ${JSON.stringify(e)}`)

  await c.query(`SELECT public.mant_transicion($1, 'RECIBIR')`, [t3[0].id])
  await c.query(`SELECT public.mant_transicion($1, 'INICIAR')`, [t3[0].id])
  const { rows: em } = await c.query(`SELECT estado::text FROM maquinaria WHERE id=$1`, [mq[0].id])
  if (em[0].estado === 'MANTENIMIENTO') ok('iniciar un ticket de maquinaria sigue mandando el equipo a MANTENIMIENTO')
  else mal(`la maquinaria quedó en ${em[0].estado}`)

  await c.query(`SELECT public.mant_transicion($1, 'RESOLVER', NULL, 'OPERATIVA', NULL, 'Listo', 1000)`, [t3[0].id])
  await c.query(`SELECT public.mant_transicion($1, 'CERRAR')`, [t3[0].id])
  e = (await c.query(`SELECT estado::text FROM mantenimiento_tickets WHERE id=$1`, [t3[0].id])).rows[0]
  if (e.estado === 'CERRADO') ok('el camino corto de siempre (RECIBIR→INICIAR→RESOLVER→CERRAR) sigue cerrando sin aprobación')
  else mal(`el camino corto dejó ${e.estado}`)

  const { rows: ev } = await c.query(`SELECT count(*)::int AS n FROM maquinaria_eventos WHERE ticket_id=$1`, [t3[0].id])
  if (ev[0].n >= 3) ok(`la hoja de vida del equipo sigue recibiendo sus eventos (${ev[0].n})`)
  else mal(`la hoja de vida recibió ${ev[0].n} eventos`)
  const { rows: ev2 } = await c.query(`SELECT count(*)::int AS n FROM maquinaria_eventos WHERE ticket_id=$1`, [t.id])
  if (ev2[0].n === 0) ok('la OT de activo no escribe en la hoja de vida de maquinaria (ya no revienta por el NOT NULL)')
  else mal(`la OT escribió ${ev2[0].n} eventos de maquinaria`)

  // ── 3.7 El CHECK de objeto ───────────────────────────────────────────────
  await rechaza('reportar sin equipo ni activo se rechaza',
    `SELECT public.mant_reportar('CORRECTIVO','MEDIA','Sin objeto')`, [], /ni sobre ninguno/)
  await rechaza('reportar con equipo Y activo se rechaza',
    `SELECT public.mant_reportar('CORRECTIVO','MEDIA','Con los dos', $1, $2)`,
    [mq[0].id, activo], /no sobre los dos/)

  // ── 3.8 El backlog cuenta en SQL ─────────────────────────────────────────
  const { rows: bl } = await c.query(`SELECT * FROM vw_mant_backlog`)
  ok(`vw_mant_backlog responde en una fila: ${JSON.stringify(bl[0])}`)
  const { rows: ind } = await c.query(`SELECT count(*)::int AS n FROM vw_mant_indicadores`)
  ok(`vw_mant_indicadores agrupa por mes y contrato (${ind[0].n} fila/s)`)
} catch (e) {
  mal('la prueba de comportamiento se cortó', e.message)
  if (e.where) console.log(`        dónde: ${e.where}`)
} finally {
  await c.query('ROLLBACK')
}

// Nada quedó en la base.
const { rows: fin } = await c.query(`
  SELECT (SELECT count(*) FROM mantenimiento_tickets) AS tickets,
         (SELECT count(*) FROM mant_planes) AS planes,
         (SELECT count(*) FROM mant_materiales) AS materiales,
         (SELECT count(*) FROM activos) AS activos,
         (SELECT count(*) FROM ronda_visitas) AS visitas,
         (SELECT count(*) FROM ronda_puntos) AS puntos`)
console.log(`\n── 4. LA BASE QUEDÓ LIMPIA ─────────────────────────────────`)
console.log(`   ${JSON.stringify(fin[0])}`)
const sucio = Object.values(fin[0]).some((n) => Number(n) !== 0)
if (sucio) { fallos++; console.log('   MAL  quedaron filas de la prueba') }
else console.log('   ok   ni una fila de muestra')

await c.end()
console.log(`\n${fallos === 0 ? '✅ TODO VERIFICADO' : `⚠️ ${fallos} comprobación(es) fallida(s)`}`)
process.exit(fallos === 0 ? 0 : 1)

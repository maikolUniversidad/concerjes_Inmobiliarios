// Verificación del esquema del bot de WhatsApp (Puntos QR F9) contra la base.
//
// Todo corre dentro de BEGIN … ROLLBACK: no deja ni una fila. Crea un contrato,
// una sede, una persona y un número de prueba (inventado y fuera de rangos
// reales), recorre el portero, la cola y los CHECK, y lo deshace.
//
// Uso:  NODE_OPTIONS=--use-system-ca node scripts/verificar-whatsapp.mjs
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const require = createRequire(import.meta.url)
const { Client } = require('pg')
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const c = new Client({ connectionString: env.match(/^DIRECT_URL="?([^"\n]+)"?/m)[1].trim(), ssl: { rejectUnauthorized: false } })
await c.connect()

let ok = 0, mal = 0
const esperar = (nombre, cond, extra = '') => {
  if (cond) { ok++; console.log('  OK  ', nombre) }
  else { mal++; console.log('  MAL ', nombre, extra) }
}
const uno = async (sql, args) => (await c.query(sql, args)).rows[0]

await c.query('BEGIN')
try {
  // ── Montaje: contrato + sede + zona + punto + persona + canal verificado ──
  const g = await uno(`insert into grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    values ('F9-PRUEBA', 'Contrato de prueba F9', 'VIGENTE', current_date - 10, current_date + 365) returning id`)
  await c.query(`insert into grupo_reglas (grupo_id, permite_whatsapp, mensajeria_desde, mensajeria_hasta)
    values ($1, true, '07:00', '18:00')`, [g.id])
  const s = await uno(`insert into sedes (grupo_id, nombre, ciudad, activo, lat, lng)
    values ($1, 'Sede de prueba F9', 'Bogota', true, 4.65, -74.10) returning id`, [g.id])
  const pe = await uno(`insert into personas (tipo_doc, documento, nombres, apellidos, cargo, sede_id, estado)
    values ('CC', '900000091', 'Prueba', 'F9', 'Conserje', $1, 'ACTIVO') returning id`, [s.id])
  // Número INVENTADO y fuera de rangos reales: +57 300 000 0091 no existe.
  const pc = await uno(`insert into persona_canales (persona_id, canal, valor, wa_id, verificado, verificado_at, verificacion_metodo, principal)
    values ($1, 'WHATSAPP', '+573000000091', '573000000091', true, now(), 'CONSOLA', true) returning id`, [pe.id])
  const cu = await uno(`select id from whatsapp_cuentas where alias = 'simulador'`)

  // ── 1. El número se resuelve a la persona ────────────────────────────────
  const conv = await uno(`select * from crm_conversacion_resolver($1, '573000000091', 'Prueba')`, [cu.id])
  esperar('resuelve la persona por persona_canales', conv.persona_id === pe.id, conv.persona_id)
  esperar('hereda el contrato de la sede de la persona', conv.grupo_id === g.id, conv.grupo_id)
  esperar('sale de ESPERA_IDENTIDAD al identificar', conv.estado === 'SIN_VISITA', conv.estado)

  const conv2 = await uno(`select * from crm_conversacion_resolver($1, '573000000092', null)`, [cu.id])
  esperar('un número desconocido nace sin persona en ESPERA_IDENTIDAD',
    conv2.persona_id === null && conv2.estado === 'ESPERA_IDENTIDAD', conv2.estado)

  // ── 2. Idempotencia del evento (Meta reintenta 7 días) ──────────────────
  const wamid = 'wamid.HBgLNTczMDAwMDAwOTEVAgASGBQzQTRBNjU5OUFFRTAzODEwMTQ0RgA='
  const e1 = await uno(`select whatsapp_evento_registrar($1,$2,'messages',$3::jsonb,$2,'573000000091',null,now(),true) id`,
    [cu.id, wamid, JSON.stringify({ hola: 1 })])
  const e2 = await uno(`select whatsapp_evento_registrar($1,$2,'messages',$3::jsonb,$2,'573000000091',null,now(),true) id`,
    [cu.id, wamid, JSON.stringify({ hola: 1 })])
  esperar('el primer evento entra', Number(e1.id) > 0, e1.id)
  esperar('el mismo wamid cinco veces deja un solo efecto', Number(e2.id) === 0, e2.id)
  const ne = await uno(`select count(*)::int n from whatsapp_eventos where dedup_clave = $1`, [wamid])
  esperar('una sola fila en whatsapp_eventos', ne.n === 1, ne.n)

  // ── 3. Ventana de 24 horas ──────────────────────────────────────────────
  let v = await uno(`select whatsapp_ventana_abierta($1) abierta`, [conv.id])
  esperar('sin mensaje entrante NO hay ventana', v.abierta === false, v.abierta)

  await c.query(`select whatsapp_registrar_entrante($1,$2,'TEXTO','PUNTO X1Y-2Z3W','{}'::jsonb,$3,now())`,
    [conv.id, wamid, e1.id])
  v = await uno(`select whatsapp_ventana_abierta($1) abierta`, [conv.id])
  esperar('el mensaje de la persona ABRE la ventana', v.abierta === true, v.abierta)
  const cv = await uno(`select ultimo_entrante_at, ventana_vence_at, mensajes_entrantes from crm_conversaciones where id=$1`, [conv.id])
  esperar('ventana_vence_at = entrante + 24 h',
    Math.abs((new Date(cv.ventana_vence_at) - new Date(cv.ultimo_entrante_at)) / 3600000 - 24) < 0.01)
  esperar('cuenta el entrante', cv.mensajes_entrantes === 1, cv.mensajes_entrantes)

  // Idempotencia del entrante.
  await c.query(`select whatsapp_registrar_entrante($1,$2,'TEXTO','otra vez','{}'::jsonb,$3,now())`, [conv.id, wamid, e1.id])
  const nm = await uno(`select count(*)::int n from crm_mensajes where wamid=$1`, [wamid])
  esperar('el entrante repetido no se duplica', nm.n === 1, nm.n)

  // ── 4. El portero ───────────────────────────────────────────────────────
  // 4a. dentro de ventana + dentro de jornada → PENDIENTE
  let d = await uno(`select whatsapp_portero($1,'BOT',null,null,false,
      (current_date + time '10:00') at time zone 'America/Bogota') d`, [conv.id])
  esperar('dentro de ventana y jornada: PENDIENTE', d.d.estado === 'PENDIENTE', JSON.stringify(d.d))

  // 4b. fuera de la jornada DEL CONTRATO (07:00–18:00) → OMITIDO_JORNADA
  d = await uno(`select whatsapp_portero($1,'BOT',null,null,false,
      (current_date + time '21:30') at time zone 'America/Bogota') d`, [conv.id])
  esperar('fuera de jornada del contrato: OMITIDO_JORNADA', d.d.estado === 'OMITIDO_JORNADA', JSON.stringify(d.d))
  esperar('y dice que la fuente fue el CONTRATO', d.d.jornada?.fuente === 'CONTRATO', JSON.stringify(d.d.jornada))

  // 4c. fuera de jornada, pero RESPUESTA a la persona → pasa
  d = await uno(`select whatsapp_portero($1,'RESPUESTA',null,null,false,
      (current_date + time '21:30') at time zone 'America/Bogota') d`, [conv.id])
  esperar('contestarle a quien escribió de noche SÍ pasa', d.d.estado === 'PENDIENTE', JSON.stringify(d.d))

  // 4d. fuera de jornada + emergencia autorizada → pasa
  d = await uno(`select whatsapp_portero($1,'BOT',null,null,true,
      (current_date + time '21:30') at time zone 'America/Bogota') d`, [conv.id])
  esperar('la emergencia autorizada salta la jornada', d.d.estado === 'PENDIENTE', JSON.stringify(d.d))

  // 4e. fuera de la ventana de 24 h, sin plantilla → OMITIDO_VENTANA
  d = await uno(`select whatsapp_portero($1,'BOT',null,null,false, now() + interval '25 hours') d`, [conv.id])
  esperar('fuera de ventana y sin plantilla: OMITIDO_VENTANA', d.d.estado === 'OMITIDO_VENTANA', JSON.stringify(d.d))

  // 4f. fuera de ventana CON plantilla PENDIENTE → OMITIDO_PLANTILLA (se salta)
  d = await uno(`select whatsapp_portero($1,'RESPUESTA','visita_pendiente_cierre',null,false, now() + interval '25 hours') d`, [conv.id])
  esperar('una plantilla sin aprobar se salta: OMITIDO_PLANTILLA', d.d.estado === 'OMITIDO_PLANTILLA', JSON.stringify(d.d))

  // 4g. la misma plantilla APPROVED → pasa fuera de la ventana
  await c.query(`update whatsapp_plantillas set estado='APPROVED' where nombre='visita_pendiente_cierre'`)
  d = await uno(`select whatsapp_portero($1,'RESPUESTA','visita_pendiente_cierre',null,false,
      (current_date + time '09:00') at time zone 'America/Bogota' + interval '2 days') d`, [conv.id])
  esperar('una plantilla APPROVED sí sale fuera de la ventana', d.d.estado === 'PENDIENTE', JSON.stringify(d.d))

  // 4h. plantilla inexistente
  d = await uno(`select whatsapp_portero($1,'RESPUESTA','no_existe_esta',null,false, now()) d`, [conv.id])
  esperar('plantilla fuera del catálogo: OMITIDO_PLANTILLA', d.d.estado === 'OMITIDO_PLANTILLA', JSON.stringify(d.d))

  // 4i. consentimiento que no existe → OMITIDO_CONSENTIMIENTO
  d = await uno(`select whatsapp_portero($1,'RESPUESTA',null,'UBICACION',false, now()) d`, [conv.id])
  esperar('sin consentimiento de UBICACION: OMITIDO_CONSENTIMIENTO', d.d.estado === 'OMITIDO_CONSENTIMIENTO', JSON.stringify(d.d))

  // `created_at` explícito: NOW() es fijo dentro de una transacción, y
  // `persona_consiente()` (de F4) desempata por `id DESC`, que con UUID
  // aleatorio no sigue el orden de inserción. En producción las dos
  // declaraciones nunca caen en la misma transacción; aquí sí.
  await c.query(`insert into persona_consentimientos (persona_id, tipo, otorgado, texto_version, texto_hash, canal, created_at)
    values ($1, 'UBICACION', true, 'ubicacion.v1', 'hash-de-prueba', 'WHATSAPP', now() - interval '1 hour')`, [pe.id])
  d = await uno(`select whatsapp_portero($1,'RESPUESTA',null,'UBICACION',false, now()) d`, [conv.id])
  esperar('con el consentimiento otorgado sí pasa', d.d.estado === 'PENDIENTE', JSON.stringify(d.d))

  // Revocado: la última fila manda.
  await c.query(`insert into persona_consentimientos (persona_id, tipo, otorgado, texto_version, texto_hash, canal, created_at)
    values ($1, 'UBICACION', false, 'ubicacion.v1', 'hash-de-prueba', 'WHATSAPP', now())`, [pe.id])
  d = await uno(`select whatsapp_portero($1,'RESPUESTA',null,'UBICACION',false, now()) d`, [conv.id])
  esperar('al retirar el permiso vuelve a omitirse', d.d.estado === 'OMITIDO_CONSENTIMIENTO', JSON.stringify(d.d))

  // 4j. número bloqueado
  await c.query(`update crm_conversaciones set bloqueada=true, bloqueo_motivo='prueba' where id=$1`, [conv.id])
  d = await uno(`select whatsapp_portero($1,'RESPUESTA',null,null,false, now()) d`, [conv.id])
  esperar('un número bloqueado: OMITIDO_BLOQUEADO', d.d.estado === 'OMITIDO_BLOQUEADO', JSON.stringify(d.d))
  await c.query(`update crm_conversaciones set bloqueada=false, bloqueo_motivo=null where id=$1`, [conv.id])

  // ── 5. Jornada: turno nocturno que cruza medianoche ─────────────────────
  let j = await uno(`select whatsapp_jornada($1,null,
      (current_date + time '02:00') at time zone 'America/Bogota', '22:00','06:00') j`, [pe.id])
  esperar('22:00–06:00 a las 02:00 está DENTRO', j.j.dentro === true, JSON.stringify(j.j))
  j = await uno(`select whatsapp_jornada($1,null,
      (current_date + time '12:00') at time zone 'America/Bogota', '22:00','06:00') j`, [pe.id])
  esperar('22:00–06:00 al mediodía está FUERA', j.j.dentro === false, JSON.stringify(j.j))

  // La zona horaria importa: 23:00 en Bogotá son 04:00 UTC del día siguiente.
  j = await uno(`select whatsapp_jornada($1,null,
      (current_date + time '23:00') at time zone 'America/Bogota', '06:00','20:00') j`, [pe.id])
  esperar('las 23:00 de Bogotá quedan fuera de 06:00–20:00', j.j.dentro === false, JSON.stringify(j.j))

  // Persona retirada: nunca.
  await c.query(`update personas set estado='RETIRADO' where id=$1`, [pe.id])
  j = await uno(`select whatsapp_jornada($1,null,
      (current_date + time '10:00') at time zone 'America/Bogota') j`, [pe.id])
  esperar('a quien ya no trabaja aquí no se le escribe nunca',
    j.j.dentro === false && j.j.fuente === 'SIN_JORNADA', JSON.stringify(j.j))
  await c.query(`update personas set estado='ACTIVO' where id=$1`, [pe.id])

  // Excepción de la Ley 2191.
  const us = await uno(`select id from usuarios limit 1`)
  if (us) {
    await c.query(`insert into whatsapp_excepciones_jornada (persona_id, motivo, autorizada_por)
      values ($1, 'Cargo de dirección (prueba)', $2)`, [pe.id, us.id])
    j = await uno(`select whatsapp_jornada($1,null,
        (current_date + time '23:30') at time zone 'America/Bogota') j`, [pe.id])
    esperar('la excepción autorizada abre la jornada',
      j.j.dentro === true && j.j.fuente === 'EXCEPCION', JSON.stringify(j.j))
    await c.query(`delete from whatsapp_excepciones_jornada where persona_id=$1`, [pe.id])
  }

  // ── 6. Encolar: nace con el estado que dicta el portero ─────────────────
  const m1 = await uno(`select * from whatsapp_encolar($1,'TEXTO','Hola','{}'::jsonb,'RESPUESTA')`, [conv.id])
  esperar('un mensaje dentro de ventana nace PENDIENTE', m1.estado === 'PENDIENTE', m1.estado)
  esperar('y es SALIENTE', m1.direccion === 'SALIENTE')

  const idFijo = '11111111-2222-3333-4444-555555555555'
  const enc = `select whatsapp_encolar(p_conversacion => $1, p_texto => 'dos veces',
    p_iniciado_por => 'RESPUESTA', p_id => $2)`
  await c.query(enc, [conv.id, idFijo])
  await c.query(enc, [conv.id, idFijo])
  const nd = await uno(`select count(*)::int n from crm_mensajes where id=$1`, [idFijo])
  esperar('encolar es idempotente por p_id', nd.n === 1, nd.n)

  // La jornada DEL CONTRATO manda sobre la franja de respaldo: con la ventana
  // del contrato cerrada, ni pasando otra franja a mano sale el mensaje.
  await c.query(`update grupo_reglas set mensajeria_desde='00:00', mensajeria_hasta='00:01' where grupo_id=$1`, [g.id])
  const m2 = await uno(`select * from whatsapp_encolar(p_conversacion => $1, p_texto => 'de noche',
    p_iniciado_por => 'BOT', p_jornada_desde => '00:00', p_jornada_hasta => '23:59')`, [conv.id])
  esperar('un mensaje del bot fuera de jornada nace OMITIDO_JORNADA', m2.estado === 'OMITIDO_JORNADA', m2.estado)
  esperar('y trae el motivo escrito', !!m2.omitido_motivo, m2.omitido_motivo)
  const ev = await uno(`select count(*)::int n from ronda_eventos
    where entidad='crm_mensajes' and entidad_id=$1 and accion='OMITIDO_JORNADA'`, [m2.id])
  esperar('lo omitido queda en la auditoría de ronda_eventos', ev.n === 1, ev.n)
  await c.query(`update grupo_reglas set mensajeria_desde='07:00', mensajeria_hasta='18:00' where grupo_id=$1`, [g.id])

  // Emergencia sin autorizador: se rechaza. Con savepoint, porque una excepción
  // de plpgsql aborta la transacción entera.
  let fallo = null
  await c.query('SAVEPOINT emg')
  try {
    await c.query(`select whatsapp_encolar(p_conversacion => $1, p_texto => 'x',
      p_iniciado_por => 'BOT', p_emergencia => true)`, [conv.id])
  } catch (e) { fallo = e.message }
  await c.query('ROLLBACK TO SAVEPOINT emg')
  esperar('una emergencia sin quien la autorice se rechaza', !!fallo && /Ley 2191/.test(fallo), fallo)

  // ── 7. La cola de salida ────────────────────────────────────────────────
  let lote = await c.query(`select id, estado from whatsapp_salida_tomar($1, 50)`, [cu.id])
  esperar('la cola entrega los pendientes', lote.rows.length === 2, lote.rows.length)
  esperar('y quedan EN_PROCESO',
    (await uno(`select count(*)::int n from crm_mensajes where estado='EN_PROCESO'`)).n === 2)
  const vacio = await c.query(`select id from whatsapp_salida_tomar($1, 50)`, [cu.id])
  esperar('lo ya tomado no se vuelve a entregar', vacio.rows.length === 0, vacio.rows.length)

  // La cola RE-EVALÚA al enviar: un mensaje que se encoló dentro de la jornada
  // y sale cuando ya se cerró NO se manda. Es lo que exige la §4.4 del
  // complemento 2: el control va al encolar Y al enviar.
  await c.query(`update crm_mensajes set estado='PENDIENTE', tomado_at=null, iniciado_por='BOT' where id=$1`, [m1.id])
  await c.query(`update grupo_reglas set mensajeria_desde='00:00', mensajeria_hasta='00:01' where grupo_id=$1`, [g.id])
  const lote2 = await c.query(`select id from whatsapp_salida_tomar($1, 50)`, [cu.id])
  esperar('el portero del ENVÍO frena lo que ya no puede salir', lote2.rows.length === 0, lote2.rows.length)
  const re = await uno(`select estado, omitido_motivo from crm_mensajes where id=$1`, [m1.id])
  esperar('y lo deja OMITIDO_JORNADA al enviar', re.estado === 'OMITIDO_JORNADA', re.estado)
  await c.query(`update grupo_reglas set mensajeria_desde='07:00', mensajeria_hasta='18:00' where grupo_id=$1`, [g.id])

  // Marcar enviado, luego los statuses de Meta.
  await c.query(`update crm_mensajes set estado='EN_PROCESO' where id=$1`, [idFijo])
  const env = await uno(`select * from whatsapp_salida_enviado($1,'wamid.SALIDA-PRUEBA-0001')`, [idFijo])
  esperar('marcar enviado deja ENVIADO con su wamid',
    env.estado === 'ENVIADO' && env.wamid === 'wamid.SALIDA-PRUEBA-0001', env.estado)

  await c.query(`select whatsapp_estado_entrega('wamid.SALIDA-PRUEBA-0001','delivered')`)
  await c.query(`select whatsapp_estado_entrega('wamid.SALIDA-PRUEBA-0001','read')`)
  let st = await uno(`select estado from crm_mensajes where id=$1`, [idFijo])
  esperar('sent → delivered → read avanza', st.estado === 'LEIDO', st.estado)
  await c.query(`select whatsapp_estado_entrega('wamid.SALIDA-PRUEBA-0001','sent')`)
  st = await uno(`select estado from crm_mensajes where id=$1`, [idFijo])
  esperar('un `sent` desordenado NO desmarca un `read`', st.estado === 'LEIDO', st.estado)

  // Reintentos y códigos de error.
  const m3 = await uno(`select * from whatsapp_encolar($1,'TEXTO','falla','{}'::jsonb,'RESPUESTA')`, [conv.id])
  let f = await uno(`select * from whatsapp_salida_fallido($1,'131000','error raro')`, [m3.id])
  esperar('el primer fallo vuelve a PENDIENTE con retroceso',
    f.estado === 'PENDIENTE' && f.intentos === 1 && f.proximo_intento_at !== null, `${f.estado}/${f.intentos}`)
  for (let i = 0; i < 5; i++) f = await uno(`select * from whatsapp_salida_fallido($1,'131000','error raro')`, [m3.id])
  esperar('al sexto fallo queda FALLIDO', f.estado === 'FALLIDO', `${f.estado}/${f.intentos}`)

  const m4 = await uno(`select * from whatsapp_encolar($1,'TEXTO','caudal','{}'::jsonb,'RESPUESTA')`, [conv.id])
  f = await uno(`select * from whatsapp_salida_fallido($1,'130429','rate limit')`, [m4.id])
  esperar('el 130429 no gasta intento y reencola',
    f.estado === 'PENDIENTE' && f.intentos === 0, `${f.estado}/${f.intentos}`)
  f = await uno(`select * from whatsapp_salida_fallido($1,'190','token invalido')`, [m4.id])
  esperar('el 190 detiene la cola en EN_ESPERA_CREDENCIAL y no descarta',
    f.estado === 'EN_ESPERA_CREDENCIAL', f.estado)

  // ── 8. El reclamo de entrada: uno por número, en orden ──────────────────
  await c.query(`update whatsapp_eventos set estado='PENDIENTE', tomado_at=null, intentos=0 where cuenta_id=$1`, [cu.id])
  for (const [k, t] of [['A', '-3 minutes'], ['B', '-1 minutes'], ['C', '-2 minutes']]) {
    await c.query(`select whatsapp_evento_registrar($1,$2,'messages','{}'::jsonb,$2,'573000000091',null, now() + interval '${t}', true)`,
      [cu.id, 'wamid.ORDEN-' + k])
  }
  const t1 = await c.query(`select dedup_clave from whatsapp_evento_tomar(10)`)
  esperar('toma UN solo evento por número', t1.rows.length === 1, JSON.stringify(t1.rows))
  const t2 = await c.query(`select dedup_clave from whatsapp_evento_tomar(10)`)
  esperar('y no toma otro del mismo número mientras uno está EN_PROCESO', t2.rows.length === 0, JSON.stringify(t2.rows))
  await c.query(`select whatsapp_evento_cerrar($1,'PROCESADO')`,
    [(await uno(`select id from whatsapp_eventos where estado='EN_PROCESO' limit 1`)).id])
  const t3 = await c.query(`select dedup_clave from whatsapp_evento_tomar(10)`)
  esperar('al cerrarlo sigue el siguiente, el más viejo primero', t3.rows.length === 1, JSON.stringify(t3.rows))

  // ── 9. Lo que los CHECK no dejan pasar ──────────────────────────────────
  const rechaza = async (nombre, sql, args) => {
    try { await c.query('SAVEPOINT sp'); await c.query(sql, args); await c.query('ROLLBACK TO SAVEPOINT sp'); esperar(nombre, false, 'no falló') }
    catch { await c.query('ROLLBACK TO SAVEPOINT sp'); esperar(nombre, true) }
  }
  await rechaza('ninguna plantilla puede ser MARKETING',
    `insert into whatsapp_plantillas (nombre, categoria, cuerpo) values ('promo_x','MARKETING','hola')`)
  await rechaza('un omitido sin motivo no entra',
    `insert into crm_mensajes (conversacion_id, cuenta_id, direccion, tipo, estado)
     values ($1,$2,'SALIENTE','TEXTO','OMITIDO_VENTANA')`, [conv.id, cu.id])
  await rechaza('una emergencia sin autorizador no entra',
    `insert into crm_mensajes (conversacion_id, cuenta_id, direccion, tipo, estado, emergencia)
     values ($1,$2,'SALIENTE','TEXTO','PENDIENTE',true)`, [conv.id, cu.id])
  await rechaza('un entrante sin wamid no entra',
    `insert into crm_mensajes (conversacion_id, cuenta_id, direccion, tipo, estado)
     values ($1,$2,'ENTRANTE','TEXTO','RECIBIDO')`, [conv.id, cu.id])
  await rechaza('una cuenta real sin waba_id no entra',
    `insert into whatsapp_cuentas (alias, transporte, estado) values ('falsa','META','ACTIVA')`)
  await rechaza('un wa_id que no es un número no entra',
    `insert into crm_conversaciones (cuenta_id, wa_id) values ($1,'no-soy-numero')`, [cu.id])
  await rechaza('un estado de visita sin visita no entra',
    `insert into crm_conversaciones (cuenta_id, wa_id, estado) values ($1,'573000000099','EN_EJECUCION')`, [cu.id])
  await rechaza('dos conversaciones del mismo número en la misma cuenta',
    `insert into crm_conversaciones (cuenta_id, wa_id) values ($1,'573000000091')`, [cu.id])
  await rechaza('un medio DESCARGADO sin sha256 no entra',
    `insert into whatsapp_medios (mensaje_id, conversacion_id, media_id, estado)
     values ($1,$2,'m1','DESCARGADO')`, [m3.id, conv.id])
  await rechaza('una excepción de jornada sin motivo no entra',
    `insert into whatsapp_excepciones_jornada (persona_id, motivo, autorizada_por) values ($1,'   ',$2)`,
    [pe.id, us ? us.id : null])

  // ── 10. RLS: un usuario sin el permiso no ve nada ───────────────────────
  const usr = await uno(`select u.id from usuarios u where u.rol not in ('ADMIN','SUPER_ADMIN') limit 1`)
  if (usr) {
    await c.query(`SAVEPOINT rls`)
    await c.query(`select set_config('request.jwt.claims', $1, true)`,
      [JSON.stringify({ sub: usr.id, role: 'authenticated' })])
    await c.query(`set local role authenticated`)
    const n1 = await uno(`select count(*)::int n from crm_conversaciones`)
    esperar('sin ver_whatsapp no ve ninguna conversación', n1.n === 0, n1.n)
    const n2 = await uno(`select count(*)::int n from whatsapp_credenciales`)
    esperar('nadie lee whatsapp_credenciales con una sesión normal', n2.n === 0, n2.n)
    const n3 = await uno(`select count(*)::int n from whatsapp_plantillas`)
    esperar('sin ver_whatsapp no ve el catálogo de plantillas', n3.n === 0, n3.n)
    await c.query(`ROLLBACK TO SAVEPOINT rls`)
  }
} finally {
  await c.query('ROLLBACK')
}

console.log(`\n${ok} bien, ${mal} mal`)
await c.end()
process.exit(mal === 0 ? 0 : 1)

// Recorre un ENVÍO MASIVO de punta a punta (Puntos QR F10) con el simulador de
// F9, contra la base de datos de verdad y por el camino de verdad.
//
// Qué prueba, y por qué así:
//   · La audiencia se resuelve con la RPC real: una fila por persona, con el
//     motivo de quien queda fuera.
//   · El escalonado se comprueba CORRIENDO EL CRON VARIAS VECES: en la primera
//     vuelta solo salen los destinos cuya hora ya venció. Si el reparto no
//     funcionara, saldrían todos de golpe.
//   · El envío lo manda el cron de salida de F9, con su control de caudal y su
//     portero. F10 no manda nada por su cuenta.
//   · La jornada se prueba cerrando la ventana del contrato: lo que no es
//     emergencia queda APLAZADO a la siguiente apertura, con su evento.
//   · El menú y la próxima parada se prueban INYECTANDO MENSAJES por el webhook
//     firmado, igual que haría Meta: pasan por la firma, la deduplicación, la
//     cola, la máquina y el portero.
//
// Antes de correr: el servidor de desarrollo arriba con `WHATSAPP_SIMULADOR=1`,
// `WHATSAPP_APP_SECRET` y `CRON_SECRET` en el entorno de la app.
//
//   NODE_OPTIONS=--use-system-ca node scripts/simular-envio-masivo.mjs
//   NODE_OPTIONS=--use-system-ca node scripts/simular-envio-masivo.mjs --limpiar
//
// Los datos de muestra se crean al empezar y SE BORRAN al terminar. Los números
// son inventados y están fuera de rangos reales (+57 300 000 01xx no existe), y
// los nombres son de fantasía: este repositorio es público.
import { createRequire } from 'module'
import { readFileSync } from 'fs'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const leerEnv = (k) => {
  const m = env.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm'))
  return m ? m[1].trim() : ''
}

const BASE = process.env.SIM_BASE_URL || 'http://localhost:3001'
const CRON = process.env.CRON_SECRET || leerEnv('CRON_SECRET')
const MARCA = 'ZZF10-ENVIO'
// Números INVENTADOS y fuera de rangos reales de Colombia.
const NUMEROS = ['573000000101', '573000000102', '573000000103', '573000000104']

const cliente = new Client({
  connectionString: leerEnv('DIRECT_URL'),
  ssl: { rejectUnauthorized: false },
})
await cliente.connect()
const q = async (sql, args) => (await cliente.query(sql, args)).rows
const uno = async (sql, args) => (await q(sql, args))[0]
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

let fallos = []
const esperar = (etiqueta, cond, detalle = '') => {
  if (cond) console.log(`   ✓ ${etiqueta}`)
  else {
    fallos.push(`${etiqueta} ${detalle}`)
    console.log(`   ✗ ${etiqueta} ${detalle === '' ? '' : JSON.stringify(detalle)}`)
  }
}
const titulo = (t) => console.log(`\n${'─'.repeat(70)}\n${t}\n${'─'.repeat(70)}`)

/* ─────────────────────────────── Limpieza ─────────────────────────────────── */

async function limpiar() {
  const g = await uno(`select id from grupos_contrato where codigo = $1`, [MARCA])
  const cuenta = await uno(`select id from whatsapp_cuentas where alias = 'simulador'`)
  if (cuenta) {
    for (const wa of NUMEROS) {
      await cliente.query(`delete from crm_conversaciones where cuenta_id = $1 and wa_id = $2`, [cuenta.id, wa])
      await cliente.query(`delete from whatsapp_eventos where wa_id = $1`, [wa])
    }
  }
  await cliente.query(`delete from whatsapp_plantillas where nombre = 'zzf10_aviso'`)
  if (g) {
    await cliente.query(`delete from crm_envios where grupo_id = $1`, [g.id])
    await cliente.query(`delete from ronda_eventos where grupo_id = $1`, [g.id])
    await cliente.query(`delete from ronda_ruta_paradas where grupo_id = $1`, [g.id])
    await cliente.query(`delete from ronda_rutas where grupo_id = $1`, [g.id])
    await cliente.query(`delete from ronda_asignaciones where grupo_id = $1`, [g.id])
    await cliente.query(`delete from persona_consentimientos where persona_id in
      (select id from personas where documento like '9000003%')`)
    await cliente.query(`delete from persona_canales where persona_id in
      (select id from personas where documento like '9000003%')`)
    await cliente.query(`delete from personas where documento like '9000003%'`)
    await cliente.query(`delete from sedes where grupo_id = $1`, [g.id])
    await cliente.query(`delete from grupo_reglas where grupo_id = $1`, [g.id])
    await cliente.query(`delete from crm_menu_opciones where grupo_id = $1`, [g.id])
    // Las zonas, los puntos y las plantillas se van en la cascada del contrato:
    // una plantilla PUBLICADA está congelada por el trigger de F3 y no se puede
    // borrar sola, a propósito.
    await cliente.query(`delete from grupos_contrato where id = $1`, [g.id])
  }
}

await limpiar()
if (process.argv.includes('--limpiar')) {
  console.log('Datos de muestra borrados.')
  await cliente.end()
  process.exit(0)
}

/* ─────────────────────────────── Montaje ──────────────────────────────────── */

titulo('Montando los datos de muestra')

const g = await uno(`insert into grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
  values ($1, 'Contrato de simulación F10', 'VIGENTE', current_date - 10, current_date + 365)
  returning id`, [MARCA])
// Jornada amplia para empezar: la simulación corre a la hora que corra.
await cliente.query(`insert into grupo_reglas (grupo_id, permite_whatsapp, mensajeria_desde, mensajeria_hasta)
  values ($1, true, '00:00', '23:59')`, [g.id])
const sede = await uno(`insert into sedes (grupo_id, nombre, ciudad, activo, lat, lng)
  values ($1, 'Sede de simulación F10', 'Bogota', true, 4.65, -74.10) returning id`, [g.id])
const zona = await uno(`insert into ronda_zonas (grupo_id, sede_id, codigo, nombre, orden)
  values ($1, $2, 'ZZF10Z', 'Zona de simulación F10', 1) returning id`, [g.id, sede.id])
const punto1 = await uno(`insert into ronda_puntos
  (grupo_id, sede_id, zona_id, codigo, nombre, descripcion, piso, lat, lng,
   geocerca_metros, exige_geocerca, estado, orden, sede_nombre)
  values ($1,$2,$3,'ZZF10P1','Porteria norte','Entrando a la izquierda','1',
          4.65, -74.10, 75, true, 'ACTIVO', 1, 'Sede de simulación F10')
  returning id, codigo`, [g.id, sede.id, zona.id])
const punto2 = await uno(`insert into ronda_puntos
  (grupo_id, sede_id, zona_id, codigo, nombre, descripcion, piso, lat, lng,
   geocerca_metros, exige_geocerca, estado, orden, sede_nombre)
  values ($1,$2,$3,'ZZF10P2','Cuarto de bombas','Al fondo del sotano, puerta gris','-1',
          4.651, -74.101, 75, true, 'ACTIVO', 2, 'Sede de simulación F10')
  returning id, codigo`, [g.id, sede.id, zona.id])

// Cuatro personas. Las tres primeras con WhatsApp verificado y opt-in; la cuarta
// SIN opt-in, para ver la exclusión con su motivo.
const personas = []
for (let i = 0; i < NUMEROS.length; i++) {
  const p = await uno(`insert into personas
    (tipo_doc, documento, nombres, apellidos, cargo, sede_id, estado)
    values ('CC', $1, $2, 'Simulacion', $3, $4, 'ACTIVO') returning id, nombres`,
  [`9000003${String(i + 1).padStart(2, '0')}`, ['Ana', 'Beto', 'Caro', 'Dani'][i],
    i === 1 ? 'Supervisor' : 'Conserje', sede.id])
  await cliente.query(`insert into persona_canales
    (persona_id, canal, valor, wa_id, verificado, verificado_at, verificacion_metodo, principal)
    values ($1,'WHATSAPP',$2,$3,true,now(),'CONSOLA',true)`, [p.id, `+${NUMEROS[i]}`, NUMEROS[i]])
  if (i < 3) {
    await cliente.query(`insert into persona_consentimientos
      (persona_id, tipo, otorgado, texto_version, texto_hash, canal)
      values ($1,'WHATSAPP',true,'zzf10','zzf10hash','WHATSAPP')`, [p.id])
  }
  personas.push({ ...p, wa: NUMEROS[i] })
}

// La ruta de F8 de la primera persona: la próxima parada es la segunda.
const ruta = await uno(`insert into ronda_rutas
  (grupo_id, sede_id, persona_id, codigo, nombre, fecha, estado, activo)
  values ($1,$2,$3,'ZZF10R','Ruta de simulación F10',
          (now() at time zone 'America/Bogota')::date, 'EN_CURSO', true) returning id`,
[g.id, sede.id, personas[0].id])
await cliente.query(`insert into ronda_ruta_paradas
  (ruta_id, grupo_id, sede_id, punto_id, numero_parada, estado, llegado_at)
  values ($1,$2,$3,$4,1,'CUMPLIDA', now() - interval '30 minutes'),
         ($1,$2,$3,$5,2,'PENDIENTE', null)`,
[ruta.id, g.id, sede.id, punto1.id, punto2.id])

// La plantilla aprobada. Las diez de F9 y las dos de F10 están PENDIENTE porque
// nadie las aprobó en Meta todavía, y fuera de la ventana de 24 h solo sale una
// APPROVED: sin esta fila, el envío entero nacería omitido (que es, de hecho,
// el comportamiento correcto y se verifica aparte).
await cliente.query(`insert into whatsapp_plantillas
  (nombre, categoria, idioma, encabezado, cuerpo, variables, estado, meta_id, proposito)
  values ('zzf10_aviso','UTILITY','es_CO','Aviso de operación','Hola {{1}}. {{2}}',
          '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"Aviso"}]'::jsonb,
          'APPROVED','zzf10','Plantilla aprobada solo para la simulación de F10.')`)

const cuenta = await uno(`select id, alias, transporte, throughput_mps from whatsapp_cuentas
  where alias = 'simulador'`)
console.log(`   contrato ${MARCA} · ${personas.length} personas (3 con opt-in) · cuenta "${cuenta.alias}" (${cuenta.transporte})`)
console.log(`   ruta con 2 paradas: la próxima es ${punto2.codigo} — Cuarto de bombas`)

/* ─────────────────────────── Ayudas de red ────────────────────────────────── */

async function cron(ruta) {
  const r = await fetch(`${BASE}/api/cron/${ruta}`, {
    headers: CRON ? { Authorization: `Bearer ${CRON}` } : {},
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) {
    fallos.push(`cron ${ruta}: HTTP ${r.status} ${JSON.stringify(cuerpo)}`)
    console.log(`   ✗ cron ${ruta}: HTTP ${r.status} ${JSON.stringify(cuerpo)}`)
    return null
  }
  return cuerpo
}

async function inyectar(entrada) {
  const r = await fetch(`${BASE}/api/whatsapp/simulador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(CRON ? { Authorization: `Bearer ${CRON}` } : {}) },
    body: JSON.stringify({ entrada }),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) {
    fallos.push(`simulador: HTTP ${r.status} ${JSON.stringify(cuerpo)}`)
    console.log(`   ✗ simulador: HTTP ${r.status} ${JSON.stringify(cuerpo)}`)
    return null
  }
  if (cuerpo?.webhook?.estado !== 200) {
    fallos.push(`el webhook devolvió ${cuerpo?.webhook?.estado}`)
  }
  return cuerpo
}

/** Los mensajes salientes de una conversación, nuevos primero los no vistos. */
const vistos = new Map()
async function dijo(wa) {
  const conv = await uno(`select id, estado from crm_conversaciones
    where cuenta_id = $1 and wa_id = $2`, [cuenta.id, wa])
  if (!conv) return { conv: null, nuevos: [] }
  const filas = await q(`select direccion, tipo, estado, texto, payload, omitido_motivo
    from crm_mensajes where conversacion_id = $1 order by created_at, id`, [conv.id])
  const desde = vistos.get(wa) ?? 0
  vistos.set(wa, filas.length)
  const nuevos = filas.slice(desde).filter((m) => m.direccion === 'SALIENTE')
  for (const m of nuevos) {
    const p = m.payload ?? {}
    const cuerpo = p.texto ?? p.cuerpo ?? m.texto ?? `[${m.tipo}]`
    const extra = p.secciones
      ? `\n        [${p.botonTexto}] ${p.secciones.flatMap((s) => s.filas.map((f) => f.titulo)).join(' · ')}`
      : p.botones ? `  [ ${p.botones.map((b) => b.texto).join(' | ')} ]` : ''
    const marca = m.estado === 'SIMULADO' ? '🤖' : m.estado.startsWith('OMITIDO') ? '🚫' : '⏳'
    console.log(`     ${marca} ${String(cuerpo).replace(/\n/g, '\n        ')}${extra}`)
    if (m.estado.startsWith('OMITIDO')) console.log(`        ↳ ${m.estado}: ${m.omitido_motivo}`)
  }
  return { conv, nuevos }
}

/* ══════════════════ 1. Un envío masivo, de punta a punta ═══════════════════ */

titulo('1. Un envío masivo a todo el contrato, con el ritmo del número')

// OJO con `select (f(...)).*`: llama a la función UNA VEZ POR COLUMNA del
// resultado, así que con una tabla de 38 columnas crearía 38 envíos. Se llama
// con `select * from f(...)`, que la ejecuta una sola vez.
const envio = await uno(`select * from public.crm_envio_crear(
    p_grupo => $1,
    p_nombre => 'Cambio de ingreso por obra',
    p_tipo => 'AVISO',
    p_alcance => 'CONTRATO',
    p_plantilla => 'zzf10_aviso',
    p_variables => '["{nombre}","Mañana el ingreso a {sede} es por la puerta 2."]'::jsonb,
    p_texto => 'Hola {nombre}. Mañana el ingreso a {sede} es por la puerta 2.',
    p_prioridad => 8,
    p_escalon_mps => 0.25,
    p_costo_unitario => 25.5
  )`, [g.id])
console.log(`   envío "${envio.nombre}" en ${envio.estado}, a 0,25 mensajes por segundo (4 s entre destinos)`)
// Se calientan las rutas ANTES de medir: en desarrollo, la primera llamada a una
// ruta de Next la compila y eso tarda segundos, que se comerían el escalonado.
await cron('crm-envios')
await cron('whatsapp-salida')

const resumen = (await uno(`select public.crm_envio_resolver($1) as r`, [envio.id])).r
console.log(`   audiencia: ${resumen.destinos} entran · ${resumen.excluidos} quedan fuera ${JSON.stringify(resumen.exclusiones)}`)
esperar('entran las 3 personas con opt-in', resumen.destinos === 3, resumen)
esperar('la persona sin opt-in queda fuera con su motivo',
  resumen.exclusiones?.SIN_CONSENTIMIENTO === 1, resumen.exclusiones)

const destinos = await q(`select d.estado, d.canal_valor, pe.nombres
  from crm_envio_destinos d join personas pe on pe.id = d.persona_id
  where d.envio_id = $1 order by pe.documento`, [envio.id])
esperar('hay UNA fila por persona, no un envío a un grupo', destinos.length === 4, destinos.length)

const tot = await uno(`select total_destinos, total_excluidos, costo_estimado, estado
  from crm_envios where id = $1`, [envio.id])
esperar('el costo estimado se calcula antes de confirmar (§4.1)',
  Number(tot.costo_estimado) === 76.5, tot.costo_estimado)

await cliente.query(`select public.crm_envio_aprobar($1, null, 15)`, [envio.id])
const horas = await q(`select programado_para from crm_envio_destinos
  where envio_id = $1 and estado = 'PENDIENTE' order by programado_para`, [envio.id])
const saltos = horas.slice(1).map((h, i) => h.programado_para.getTime() - horas[i].programado_para.getTime())
console.log(`   escalonado: ${horas.length} destinos, separados ${saltos.join(' / ')} ms`)
esperar('aprobar reparte la hora de cada destino a 1/mps (4 s a 0,25 mps)',
  saltos.every((s) => Math.abs(s - 4000) < 50), saltos)

// La primera vuelta del cron: solo puede encolar lo que ya venció.
const vuelta1 = await cron('crm-envios')
console.log(`   cron (vuelta 1): ${JSON.stringify(vuelta1)}`)
esperar('la primera vuelta NO encola el envío entero: el escalonado manda',
  (vuelta1?.encolados ?? 0) < 3 && (vuelta1?.encolados ?? 0) >= 1, vuelta1)

await dormir(9000)
const vuelta2 = await cron('crm-envios')
console.log(`   cron (vuelta 2, 9 s después): ${JSON.stringify(vuelta2)}`)
const encolados = await uno(`select count(*)::int as n from crm_envio_destinos
  where envio_id = $1 and estado in ('ENCOLADO','ENVIADO','ENTREGADO','LEIDO','SIMULADO')`, [envio.id])
esperar('al vencer sus horas, los tres quedan encolados', encolados.n === 3, encolados.n)

const mensajes = await q(`select m.id, m.tipo, m.es_plantilla, m.plantilla_nombre, m.plantilla_variables,
    m.texto, m.estado, m.prioridad, m.conversacion_id, d.id as destino_id
  from crm_envio_destinos d join crm_mensajes m on m.id = d.mensaje_id
  where d.envio_id = $1`, [envio.id])
esperar('un mensaje por persona, cada uno en su propia conversación',
  mensajes.length === 3 && new Set(mensajes.map((m) => m.conversacion_id)).size === 3, mensajes.length)
esperar('el id del mensaje es el id de su destino (idempotencia)',
  mensajes.every((m) => m.id === m.destino_id))
esperar('sale como PLANTILLA aprobada', mensajes.every((m) => m.es_plantilla && m.tipo === 'PLANTILLA'))
esperar('con prioridad 8: lo masivo no tapa al conserje parado en un punto',
  mensajes.every((m) => m.prioridad === 8))
console.log('   variables resueltas por persona:')
for (const m of mensajes) console.log(`     · ${JSON.stringify(m.plantilla_variables)}`)
esperar('cada mensaje lleva el nombre de SU persona',
  new Set(mensajes.map((m) => m.plantilla_variables[0])).size === 3,
  mensajes.map((m) => m.plantilla_variables[0]))
esperar('y la sede resuelta en el texto',
  mensajes.every((m) => (m.texto ?? '').includes('Sede de simulación F10')), mensajes[0]?.texto)

// Ahora sí: el cron de salida de F9, con su control de caudal.
const salida = await cron('whatsapp-salida')
console.log(`   cron de salida (F9): ${JSON.stringify(salida)}`)
const enviados = await q(`select d.estado, m.estado as mestado, m.enviado_at
  from crm_envio_destinos d join crm_mensajes m on m.id = d.mensaje_id
  where d.envio_id = $1 order by m.enviado_at`, [envio.id])
esperar('los tres salieron por el buzón de F9 (SIMULADO: nada llegó a un teléfono)',
  enviados.filter((x) => x.mestado === 'SIMULADO').length === 3, enviados.map((x) => x.mestado))
esperar('el estado del mensaje llega al destino del envío por el espejo',
  enviados.every((x) => x.estado === 'ENVIADO'), enviados.map((x) => x.estado))
if (enviados.length === 3 && enviados.every((x) => x.enviado_at)) {
  const d1 = enviados[2].enviado_at.getTime() - enviados[0].enviado_at.getTime()
  console.log(`   los tres salieron en ${d1} ms (a 15 mps el mínimo son ~134 ms)`)
  esperar('el envío respeta el caudal: no salen en el mismo milisegundo', d1 >= 100, d1)
}

// El cierre del envío lo hace la vuelta siguiente del cron: su último mensaje
// se encoló en una vuelta y se envió en la otra. Es el camino real.
await cron('crm-envios')
const vista = await uno(`select * from crm_envios_resumen where envio_id = $1`, [envio.id])
console.log(`   tablero: ${vista.enviados} enviados · ${vista.excluidos} fuera de audiencia · estado ${vista.estado}`)
esperar('el envío queda COMPLETADO cuando no queda nada por salir',
  vista.estado === 'COMPLETADO', vista.estado)

/* ══════════════════════ 2. La jornada y la emergencia ═════════════════════ */

titulo('2. Fuera de la jornada: se aplaza, salvo emergencia')

// Se cierra la ventana del contrato: una franja de dos horas que NO contiene a
// ahora, calculada en hora de Bogotá (que es la que mira whatsapp_jornada).
await cliente.query(`update grupo_reglas
   set mensajeria_desde = ((now() at time zone 'America/Bogota') + interval '2 hours')::time,
       mensajeria_hasta = ((now() at time zone 'America/Bogota') + interval '4 hours')::time
 where grupo_id = $1`, [g.id])
const franja = await uno(`select mensajeria_desde, mensajeria_hasta from grupo_reglas where grupo_id = $1`, [g.id])
console.log(`   jornada del contrato ahora: ${franja.mensajeria_desde} a ${franja.mensajeria_hasta} (cerrada)`)

const eFuera = await uno(`select * from public.crm_envio_crear(
    p_grupo => $1, p_nombre => 'Aviso fuera de jornada', p_alcance => 'PERSONAS',
    p_personas => ARRAY[$2::uuid], p_plantilla => 'zzf10_aviso',
    p_variables => '["{nombre}","Aviso que puede esperar."]'::jsonb,
    p_texto => 'Hola {nombre}. Aviso que puede esperar.')`, [g.id, personas[0].id])
await cliente.query(`select public.crm_envio_resolver($1)`, [eFuera.id])
await cliente.query(`select public.crm_envio_aprobar($1, null, 15)`, [eFuera.id])
const vFuera = await cron('crm-envios')
console.log(`   cron: ${JSON.stringify(vFuera)}`)
const dFuera = await uno(`select estado, programado_para, aplazos, jornada, mensaje_id
  from crm_envio_destinos where envio_id = $1`, [eFuera.id])
esperar('el destino queda APLAZADO, no omitido', dFuera.estado === 'APLAZADO', dFuera.estado)
esperar('no se creó ningún mensaje al aplazar', dFuera.mensaje_id === null)
const faltanH = (dFuera.programado_para.getTime() - Date.now()) / 3600_000
console.log(`   aplazado a ${dFuera.programado_para.toISOString()} (en ${faltanH.toFixed(2)} h)`)
esperar('aplazado a la próxima apertura de la jornada', faltanH > 1.8 && faltanH < 2.3, faltanH)
esperar('guarda con qué jornada se decidió y de qué fuente',
  dFuera.jornada?.fuente === 'CONTRATO', dFuera.jornada)
const evento = await uno(`select accion, detalle from ronda_eventos
  where entidad = 'crm_envio_destinos' and accion = 'ENVIO_APLAZADO_JORNADA'
  order by id desc limit 1`)
esperar('el aplazamiento queda en la auditoría', evento?.accion === 'ENVIO_APLAZADO_JORNADA', evento)

// La misma hora, pero autorizada como emergencia.
const admin = await uno(`select id from usuarios order by created_at limit 1`)
const eEmerg = await uno(`insert into crm_envios
  (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, plantilla_nombre,
   variables, texto, estado, es_emergencia, emergencia_por, emergencia_motivo)
  values ($1,$2,'Evacuación de la sede','PERSONAS',ARRAY[$3::uuid],'zzf10_aviso',
          '["{nombre}","Evacuación de {sede}: salgan por la puerta 2."]'::jsonb,
          'Hola {nombre}. Evacuación de {sede}: salgan por la puerta 2.',
          'BORRADOR', true, $4, 'Simulacro de evacuación de la simulación F10')
  returning id`, [g.id, cuenta.id, personas[2].id, admin.id])
await cliente.query(`select public.crm_envio_resolver($1)`, [eEmerg.id])
await cliente.query(`select public.crm_envio_aprobar($1, null, 15)`, [eEmerg.id])
const vEmerg = await cron('crm-envios')
console.log(`   cron (emergencia): ${JSON.stringify(vEmerg)}`)
const dEmerg = await uno(`select d.estado, d.es_emergencia, m.emergencia, m.emergencia_por, m.texto
  from crm_envio_destinos d left join crm_mensajes m on m.id = d.mensaje_id
  where d.envio_id = $1`, [eEmerg.id])
esperar('una emergencia SÍ sale fuera de la jornada', dEmerg.estado === 'ENCOLADO', dEmerg.estado)
esperar('el destino y el mensaje quedan marcados, con quién lo autorizó',
  dEmerg.es_emergencia === true && dEmerg.emergencia === true && dEmerg.emergencia_por === admin.id)
console.log(`   texto: «${dEmerg.texto}»`)
await cron('whatsapp-salida')

// Se devuelve la jornada abierta para lo que queda de la simulación.
await cliente.query(`update grupo_reglas set mensajeria_desde = '00:00', mensajeria_hasta = '23:59'
  where grupo_id = $1`, [g.id])

/* ════════════════════ 3. El menú y la próxima ubicación ═══════════════════ */

titulo('3. El menú del bot y la próxima ubicación, por el webhook de verdad')

// Un menú propio de este contrato, para ver que gana sobre el general.
await cliente.query(`insert into crm_menu_opciones
    (grupo_id, cargo, orden, etiqueta, descripcion, accion, texto)
  values ($1, null, 1, 'Mi proximo punto', 'A donde seguis y como llegar', 'PROXIMA_UBICACION', null),
         ($1, null, 2, 'Mis puntos de hoy', 'Los puntos que te tocan hoy', 'MIS_PUNTOS', null),
         ($1, null, 3, 'Telefono de la porteria', null, 'TEXTO',
          'La porteria contesta en la extension 101.')`, [g.id])

const wa = personas[0].wa
console.log(`\n   👤 (${personas[0].nombres}) escribe: MENÚ`)
await inyectar({ clase: 'texto', waId: wa, texto: 'MENÚ', perfil: 'Ana' })
let r = await dijo(wa)
const lista = r.nuevos.find((m) => m.tipo === 'LISTA')
esperar('el bot responde con una lista', !!lista, r.nuevos.map((m) => m.tipo))
const filasMenu = lista ? (lista.payload.secciones ?? []).flatMap((s) => s.filas) : []
esperar('son las opciones configuradas para ESTE contrato, no el menú general',
  filasMenu.length === 3 && filasMenu[0].titulo === 'Mi proximo punto', filasMenu.map((f) => f.titulo))
esperar('cada fila respeta el tope de 24 caracteres de WhatsApp',
  filasMenu.every((f) => f.titulo.length <= 24), filasMenu.map((f) => f.titulo.length))

// Se toca la primera opción, con el id que el bot REALMENTE mandó.
const idProxima = filasMenu[0]?.id
console.log(`\n   👤 toca «${filasMenu[0]?.titulo}» (id ${idProxima})`)
await inyectar({ clase: 'lista', waId: wa, idRespuesta: idProxima, tituloRespuesta: filasMenu[0]?.titulo })
r = await dijo(wa)
const respProxima = r.nuevos.map((m) => m.payload?.texto ?? m.texto ?? '').join(' ')
esperar('la opción del menú contesta con la próxima parada que dice F8',
  respProxima.includes(punto2.codigo) && respProxima.includes('Cuarto de bombas'), respProxima)
esperar('y con la referencia de cómo llegar que tiene el punto (§4.3)',
  respProxima.includes('Al fondo del sotano'), respProxima)

// El mismo dato, pedido por texto.
console.log('\n   👤 escribe: mi próximo punto')
await inyectar({ clase: 'texto', waId: wa, texto: 'mi próximo punto' })
r = await dijo(wa)
const porTexto = r.nuevos.map((m) => m.payload?.texto ?? m.texto ?? '').join(' ')
esperar('el comando de texto da la misma respuesta', porTexto.includes(punto2.codigo), porTexto)

// La opción de texto fijo.
console.log(`\n   👤 toca «${filasMenu[2]?.titulo}»`)
await inyectar({ clase: 'lista', waId: wa, idRespuesta: filasMenu[2]?.id, tituloRespuesta: filasMenu[2]?.titulo })
r = await dijo(wa)
const textoFijo = r.nuevos.map((m) => m.payload?.texto ?? m.texto ?? '').join(' ')
esperar('una opción de texto fijo contesta ese texto',
  textoFijo.includes('extension 101'), textoFijo)

// Alguien SIN ruta de hoy: no se inventa un punto.
const wa3 = personas[2].wa
console.log(`\n   👤 (${personas[2].nombres}, sin ruta hoy) escribe: a dónde sigo`)
await inyectar({ clase: 'texto', waId: wa3, texto: 'a donde sigo', perfil: 'Caro' })
r = await dijo(wa3)
const sinRuta = r.nuevos.map((m) => m.payload?.texto ?? m.texto ?? '').join(' ')
esperar('sin ruta de hoy el bot lo dice, no inventa un punto',
  sinRuta.toLowerCase().includes('no tenés una ruta') || sinRuta.toLowerCase().includes('no tenes una ruta'),
  sinRuta)

/* ═══════════════════════════════ Cierre ═══════════════════════════════════ */

titulo('Cierre')
const cuentas = await uno(`select
    (select count(*) from crm_envios where grupo_id = $1) as envios,
    (select count(*) from crm_envio_destinos where grupo_id = $1) as destinos,
    (select count(*) from crm_mensajes m join crm_envio_destinos d on d.mensaje_id = m.id
      where d.grupo_id = $1) as mensajes`, [g.id])
console.log(`   ${cuentas.envios} envíos · ${cuentas.destinos} destinos · ${cuentas.mensajes} mensajes`)

await limpiar()
const quedo = await uno(`select
    (select count(*) from grupos_contrato where codigo = $1) as contratos,
    (select count(*) from personas where documento like '9000003%') as personas,
    (select count(*) from whatsapp_plantillas where nombre = 'zzf10_aviso') as plantillas`, [MARCA])
esperar('los datos de muestra quedaron borrados',
  Number(quedo.contratos) === 0 && Number(quedo.personas) === 0 && Number(quedo.plantillas) === 0, quedo)

console.log(`\n${'═'.repeat(70)}`)
if (fallos.length === 0) console.log('  Todo bien.')
else {
  console.log(`  ${fallos.length} fallo(s):`)
  for (const f of fallos) console.log(`   · ${f}`)
}
console.log('═'.repeat(70))
await cliente.end()
process.exit(fallos.length === 0 ? 0 : 1)

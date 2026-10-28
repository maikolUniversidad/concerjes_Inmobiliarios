// Recorre una conversación COMPLETA del bot de WhatsApp con el simulador, de
// principio a fin, contra la base de datos de verdad y por el camino de verdad.
//
// Qué prueba y por qué así:
//   · Cada mensaje de la conserje se arma como un PAYLOAD REAL de webhook, se
//     firma con el `WHATSAPP_APP_SECRET` local y se manda por HTTP a
//     `/api/whatsapp/webhook`. O sea: pasa por la verificación de la firma, la
//     deduplicación, la cola de entrada, la máquina de estados, el portero y el
//     buzón de salida. No hay atajo.
//   · El transporte es el SIMULADO: nada sale hacia un teléfono. Lo que se
//     habría enviado queda en `crm_mensajes` con estado SIMULADO y con el mismo
//     payload que iría a Meta.
//
// Antes de correr: el servidor de desarrollo tiene que estar arriba con
// `WHATSAPP_SIMULADOR=1`, `WHATSAPP_APP_SECRET` y `CRON_SECRET` en el entorno.
//
//   NODE_OPTIONS=--use-system-ca node scripts/simular-whatsapp.mjs
//   NODE_OPTIONS=--use-system-ca node scripts/simular-whatsapp.mjs --limpiar
//
// Los datos de muestra (contrato, sede, punto, persona) se crean al empezar y
// SE BORRAN al terminar. El número es inventado y está fuera de rangos reales.

import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { createHmac, randomUUID } from 'crypto'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const leerEnv = (k) => {
  const m = env.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm'))
  return m ? m[1].trim() : ''
}

const BASE = process.env.SIM_BASE_URL || 'http://localhost:3001'
const SECRETO = process.env.WHATSAPP_APP_SECRET || leerEnv('WHATSAPP_APP_SECRET')
const CRON = process.env.CRON_SECRET || leerEnv('CRON_SECRET')
// Número INVENTADO y fuera de rangos reales de Colombia.
const WA = '573000000091'
const MARCA = 'F9-SIMULACION'

if (!SECRETO) {
  console.error('Falta WHATSAPP_APP_SECRET: sin él no se puede firmar como Meta.')
  process.exit(1)
}

const cliente = new Client({
  connectionString: leerEnv('DIRECT_URL'),
  ssl: { rejectUnautharized: false, rejectUnauthorized: false },
})
await cliente.connect()
const q = async (sql, args) => (await cliente.query(sql, args)).rows
const uno = async (sql, args) => (await q(sql, args))[0]

/* ─────────────────────────────── Limpieza ─────────────────────────────────── */

async function limpiar() {
  // En orden, porque las llaves foráneas son RESTRICT en lo que importa.
  const g = await uno(`select id from grupos_contrato where codigo = $1`, [MARCA])
  const cuenta = await uno(`select id from whatsapp_cuentas where alias = 'simulador'`)
  if (cuenta) {
    await cliente.query(`delete from crm_conversaciones where cuenta_id = $1 and wa_id = $2`, [cuenta.id, WA])
    await cliente.query(`delete from whatsapp_eventos where wa_id = $1`, [WA])
  }
  if (g) {
    await cliente.query(`delete from ronda_eventos where grupo_id = $1`, [g.id])
    await cliente.query(`delete from ronda_visitas where grupo_id = $1`, [g.id])
    await cliente.query(`delete from ronda_asignaciones where grupo_id = $1`, [g.id])
    // Las plantillas, sus pasos, los tipos de actividad, los puntos y las zonas
    // NO se borran de a uno: una plantilla PUBLICADA está CONGELADA por el
    // trigger de F3 y no se puede borrar sola, a propósito, porque hacerlo
    // reinterpretaría respuestas ya guardadas. Se van en la CASCADA del borrado
    // del contrato, que es el camino que F3 dejó abierto justamente para esto.
    await cliente.query(`delete from persona_consentimientos where persona_id in
      (select id from personas where documento like '9000000%' and nombres = 'Prueba')`)
    await cliente.query(`delete from persona_canales where valor = $1`, [`+${WA}`])
    await cliente.query(`delete from personas where documento like '9000000%' and nombres = 'Prueba'`)
    await cliente.query(`delete from sedes where grupo_id = $1`, [g.id])
    await cliente.query(`delete from grupo_reglas where grupo_id = $1`, [g.id])
    await cliente.query(`delete from grupo_vigencias where grupo_id = $1`, [g.id])
    await cliente.query(`delete from grupos_contrato where id = $1`, [g.id])
  }
  // La plantilla que la simulación aprueba se devuelve a PENDIENTE: dejarla
  // APPROVED mentiría sobre el estado real ante Meta.
  await cliente.query(`update whatsapp_plantillas set estado = 'PENDIENTE'
    where nombre = 'visita_pendiente_cierre' and meta_id is null`)
}

if (process.argv.includes('--limpiar')) {
  await limpiar()
  console.log('Datos de muestra borrados.')
  await cliente.end()
  process.exit(0)
}

/* ─────────────────────────────── Montaje ──────────────────────────────────── */

await limpiar()
console.log('── Montando los datos de muestra ──')

const g = await uno(`insert into grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
  values ($1, 'Contrato de simulación F9', 'VIGENTE', current_date - 10, current_date + 365) returning id`, [MARCA])
// Jornada de mensajería amplia: la simulación corre a la hora que corra.
await cliente.query(`insert into grupo_reglas (grupo_id, permite_whatsapp, mensajeria_desde, mensajeria_hasta, geocerca_radio_m)
  values ($1, true, '00:00', '23:59', 75)`, [g.id])
const sede = await uno(`insert into sedes (grupo_id, nombre, ciudad, activo, lat, lng)
  values ($1, 'Sede de simulación F9', 'Bogota', true, 4.6500000, -74.1000000) returning id`, [g.id])
const zona = await uno(`insert into ronda_zonas (grupo_id, sede_id, codigo, nombre, orden)
  values ($1, $2, 'Z-SIM', 'Zona de simulación', 1) returning id`, [g.id, sede.id])
// El punto está en 4.65 / -74.10 con 75 m de tolerancia.
const punto = await uno(`insert into ronda_puntos
  (grupo_id, sede_id, zona_id, codigo, nombre, descripcion, piso, lat, lng,
   geocerca_metros, exige_geocerca, estado, orden, sede_nombre)
  values ($1,$2,$3,'K7M4QX9','Porteria principal','Entrada por la calle','1',
          4.6500000, -74.1000000, 75, true, 'ACTIVO', 1, 'Sede de simulación F9')
  returning id, codigo`, [g.id, sede.id, zona.id])

const tipo = await uno(`insert into ronda_tipos_actividad (grupo_id, codigo, nombre, categoria, orden)
  values ($1, 'SIM_CONSERJERIA', 'Conserjeria de simulacion', 'CONSERJERIA', 1) returning id`, [g.id])
// Nace BORRADOR a propósito: F3 congela lo publicado con un trigger, así que
// los pasos se agregan antes y la plantilla se publica después. Es la misma
// secuencia que sigue la consola.
const plantilla = await uno(`insert into ronda_plantillas
  (grupo_id, tipo_actividad_id, codigo, version, nombre, estado, duracion_estimada_min,
   exige_firma, exige_geocerca)
  values ($1,$2,'SIM_RONDA',1,'Ronda de simulacion','BORRADOR',20,false,true)
  returning id`, [g.id, tipo.id])
const pasos = []
for (const [orden, titulo, tipoPaso] of [
  [1, 'Revisar extintor', 'NUMERO'],
  [2, 'Barrer zona comun', 'CASILLA'],
  [3, 'Cambiar bombillo', 'CASILLA'],
]) {
  const p = await uno(`insert into ronda_plantilla_pasos (plantilla_id, orden, tipo, titulo, ayuda, obligatorio, config)
    values ($1,$2,$3,$4,$5,true,$6::jsonb) returning id, titulo, tipo`,
  [plantilla.id, orden, tipoPaso, titulo,
    tipoPaso === 'NUMERO' ? 'Presion, sello y fecha de recarga' : null,
    tipoPaso === 'NUMERO' ? '{"min":0,"max":300,"unidad":"bar"}' : '{}'])
  pasos.push(p)
}
await cliente.query(`update ronda_plantillas set estado = 'PUBLICADA', publicada_at = now()
  where id = $1`, [plantilla.id])
const persona = await uno(`insert into personas (tipo_doc, documento, nombres, apellidos, cargo, sede_id, estado)
  values ('CC','900000091','Prueba','Simulacion','Conserje',$1,'ACTIVO') returning id`, [sede.id])

// La asignación EXIGE un responsable (rol, cargo o persona): F3 no deja una
// tarea asignada a nadie. Acá va la persona de prueba.
await cliente.query(`insert into ronda_asignaciones
  (grupo_id, sede_id, punto_id, plantilla_codigo, frecuencia, dias, prioridad, persona_id, activo)
  values ($1,$2,$3,'SIM_RONDA','DIARIA','{1,2,3,4,5,6,7}','MEDIA',$4,true)`,
[g.id, sede.id, punto.id, persona.id])
await cliente.query(`insert into persona_canales
  (persona_id, canal, valor, wa_id, verificado, verificado_at, verificacion_metodo, principal)
  values ($1,'WHATSAPP',$2,$3,true,now(),'CONSOLA',true)`, [persona.id, `+${WA}`, WA])

const cuenta = await uno(`select id, alias, transporte, estado from whatsapp_cuentas where alias = 'simulador'`)
console.log(`   contrato ${MARCA} · punto ${punto.codigo} · cuenta "${cuenta.alias}" (${cuenta.transporte})`)
console.log(`   ${pasos.length} tareas: ${pasos.map((p) => p.titulo).join(', ')}`)

/* ─────────────────────── El motor de la simulación ────────────────────────── */

let paso = 0
const fallos = []

async function inyectar(etiqueta, entrada, opciones = {}) {
  paso++
  const r = await fetch(`${BASE}/api/whatsapp/simulador`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(CRON ? { Authorization: `Bearer ${CRON}` } : {}) },
    body: JSON.stringify({ entrada, ...opciones }),
  })
  const cuerpo = await r.json().catch(() => null)
  if (!r.ok) {
    fallos.push(`${etiqueta}: HTTP ${r.status} ${JSON.stringify(cuerpo)}`)
    console.log(`\n${paso}. ${etiqueta}\n   ERROR HTTP ${r.status}: ${JSON.stringify(cuerpo)}`)
    return null
  }
  if (cuerpo?.webhook && cuerpo.webhook.estado !== 200) {
    fallos.push(`${etiqueta}: el webhook devolvió ${cuerpo.webhook.estado}`)
  }
  return cuerpo
}

/** Lo que el bot contestó desde el último corte, en orden. */
let vistos = 0
async function respuesta(etiqueta, loQueDijo) {
  const conv = await uno(`select id, estado, intentos, visita_id, espera_vence_at, contexto
    from crm_conversaciones where cuenta_id = $1 and wa_id = $2`, [cuenta.id, WA])
  const salida = await q(`select direccion, tipo, estado, texto, payload, omitido_motivo, prioridad
    from crm_mensajes where conversacion_id = $1 order by created_at, id`, [conv?.id])
  const nuevos = salida.slice(vistos)
  vistos = salida.length

  console.log(`\n${paso}. ${etiqueta}`)
  if (loQueDijo) console.log(`   👤 ${loQueDijo}`)
  for (const m of nuevos.filter((x) => x.direccion === 'SALIENTE')) {
    const p = m.payload ?? {}
    const cuerpo = p.texto ?? p.cuerpo ?? m.texto ?? `[${m.tipo}]`
    const extra = p.botones
      ? `  [ ${p.botones.map((b) => b.texto).join(' | ')} ]`
      : p.secciones
        ? `  [${p.botonTexto}] ${p.secciones.flatMap((s) => s.filas.map((f) => f.titulo)).join(' · ')}`
        : p.tipo === 'SOLICITUD_UBICACION' ? '  [ Enviar ubicación ]' : ''
    const marca = m.estado === 'SIMULADO' ? '🤖' : m.estado.startsWith('OMITIDO') ? '🚫' : '⏳'
    console.log(`   ${marca} ${String(cuerpo).replace(/\n/g, '\n      ')}${extra}`)
    if (m.estado.startsWith('OMITIDO')) console.log(`      ↳ ${m.estado}: ${m.omitido_motivo}`)
  }
  console.log(`   → estado: ${conv?.estado}${conv?.visita_id ? ` · visita ${conv.visita_id.slice(0, 8)}` : ''}`)
  return { conv, nuevos }
}

const esperar = (etiqueta, cond, detalle = '') => {
  if (cond) console.log(`   ✓ ${etiqueta}`)
  else {
    fallos.push(`${etiqueta} ${detalle}`)
    console.log(`   ✗ ${etiqueta} ${detalle}`)
  }
}

/** El último id de botón o de fila que el bot ofreció y que empieza con el
 *  prefijo dado. Así la simulación toca lo que el bot realmente mandó, no un id
 *  escrito a mano que podría no existir. */
function idOfrecido(nuevos, prefijo) {
  for (const m of [...nuevos].reverse()) {
    const p = m.payload ?? {}
    const ids = [
      ...(p.botones ?? []).map((b) => b.id),
      ...(p.secciones ?? []).flatMap((s) => s.filas.map((f) => f.id)),
    ]
    const hit = ids.find((i) => i && i.startsWith(prefijo))
    if (hit) return hit
  }
  return null
}

console.log('\n══════════ CONVERSACIÓN COMPLETA ══════════')

/* 1. El primer «hola»: el número ya está verificado, así que responde con la
      lista de puntos del día. */
await inyectar('Primer saludo', { clase: 'texto', waId: WA, texto: 'hola', perfil: 'Prueba' })
let r = await respuesta('Primer saludo', 'hola')
esperar('responde con la lista de puntos del día', r.nuevos.some((m) => m.tipo === 'LISTA'))
esperar('la persona quedó identificada por su número', r.conv.estado === 'SIN_VISITA', r.conv.estado)

/* 2. Escribe el código del punto. */
await inyectar('Código del punto', { clase: 'texto', waId: WA, texto: 'PUNTO K7M-4QX9' })
r = await respuesta('Código del punto', 'PUNTO K7M-4QX9')
esperar('reconoce el punto y pide confirmación', r.conv.estado === 'PUNTO_IDENTIFICADO', r.conv.estado)
esperar('NO abrió la visita sin confirmar', r.conv.visita_id === null)

/* 3. Confirma. Faltan los consentimientos, así que los pide antes de todo. */
let id = idOfrecido(r.nuevos, 'punto:') ?? 'punto:K7M4QX9:si'
await inyectar('Sí, empezar', { clase: 'boton', waId: WA, idRespuesta: id, tituloRespuesta: 'Sí, empezar' })
r = await respuesta('Sí, empezar', `[${id}]`)
esperar('pide el consentimiento antes de abrir', r.conv.estado === 'ESPERA_CONSENTIMIENTO', r.conv.estado)
esperar('la visita SÍ quedó abierta', !!r.conv.visita_id)

/* 4–6. Los tres consentimientos de la visita. El de biometría NUNCA se pide. */
for (const cual of ['UBICACION', 'FOTOS', 'AUDIO']) {
  const idc = idOfrecido(r.nuevos, 'consent:') ?? `consent:${cual}:si`
  await inyectar(`Acepta ${cual}`, { clase: 'boton', waId: WA, idRespuesta: idc, tituloRespuesta: 'Acepto' })
  r = await respuesta(`Acepta ${cual.toLowerCase()}`, '[Acepto]')
  esperar(`no se pidió el consentimiento de BIOMETRIA`,
    !r.nuevos.some((m) => JSON.stringify(m.payload ?? {}).includes('biométrico')))
}
esperar('con los tres permisos pide la ubicación', r.conv.estado === 'PUNTO_IDENTIFICADO', r.conv.estado)
esperar('la solicitud de ubicación salió', r.nuevos.some((m) => m.tipo === 'SOLICITUD_UBICACION'))
const consents = await q(`select tipo, otorgado, texto_version, texto_hash from persona_consentimientos
  where persona_id = $1 order by created_at`, [persona.id])
esperar('los tres consentimientos quedaron con su versión y su hash',
  consents.length === 3 && consents.every((c) => c.otorgado && c.texto_version && c.texto_hash.length === 64),
  JSON.stringify(consents.map((c) => `${c.tipo}/${c.texto_version}`)))

/* 7. Manda una ubicación LEJOS: a unos 160 m. Fuera del radio de 75, pero a
      menos del doble, así que ofrece reenviar y DICE LOS METROS. */
await inyectar('Ubicación lejos', {
  clase: 'ubicacion', waId: WA, lat: 4.6510, lng: -74.1000, nombreUbicacion: 'Calle',
})
r = await respuesta('Ubicación a ~110 m', '[ubicación: 4.6510, -74.1000]')
const textoLejos = r.nuevos.map((m) => (m.payload ?? {}).cuerpo ?? m.texto ?? '').join(' ')
// Fuera del radio de 75 m pero a menos del doble: se ofrece reenviar en vez de
// cerrar la puerta, y se dice la diferencia exacta.
esperar('no valida y ofrece reenviar', r.conv.estado === 'PUNTO_IDENTIFICADO', r.conv.estado)
esperar('dice la distancia EN METROS', /\d+ m/.test(textoLejos), textoLejos.slice(0, 120))
esperar('dice la tolerancia (75 m) y la diferencia', /75 m/.test(textoLejos), textoLejos.slice(0, 200))
esperar('ofrece «Estoy en el punto», que no bloquea el trabajo',
  r.nuevos.some((m) => ((m.payload ?? {}).botones ?? []).some((b) => b.id === 'ubicacion:estoy')))

/* 8. Ahora manda la ubicación buena: encima del punto. */
await inyectar('Ubicación en el punto', { clase: 'ubicacion', waId: WA, lat: 4.65, lng: -74.1 })
r = await respuesta('Ubicación en el punto', '[ubicación: 4.6500, -74.1000]')
esperar('valida la geocerca', r.conv.estado === 'UBICACION_VALIDADA', r.conv.estado)
esperar('pide la foto de inicio', r.nuevos.some((m) => /foto del punto/i.test((m.payload ?? {}).texto ?? '')))

/* 9. Un sticker: NO es una foto y NO gasta un intento. */
const antes = r.conv.intentos
await inyectar('Sticker', { clase: 'sticker', waId: WA, mediaId: 'sticker-sim' })
r = await respuesta('Manda un sticker', '[sticker]')
esperar('dice que eso no es una foto', r.nuevos.some((m) => /no es una foto/i.test((m.payload ?? {}).texto ?? '')))
esperar('y NO gasta un intento', r.conv.intentos === antes, `${antes} → ${r.conv.intentos}`)

/* 10. La foto de inicio. */
await inyectar('Foto de inicio', { clase: 'imagen', waId: WA, mediaId: 'media-inicio', mime: 'image/jpeg' })
r = await respuesta('Foto de inicio', '[foto]')
esperar('pasa a la lista de tareas', r.conv.estado === 'FOTO_INICIO_OK', r.conv.estado)
esperar('manda la lista con las 3 tareas',
  r.nuevos.some((m) => m.tipo === 'LISTA' && ((m.payload ?? {}).secciones ?? [])[0]?.filas?.length === 3))
const medios = await q(`select hito, estado, integridad, path, sha256, bucket, evidencia_id
  from whatsapp_medios where conversacion_id = $1 order by created_at`, [r.conv.id])
const inicio = medios.find((m) => m.hito === 'FOTO_INICIO')
esperar('el medio quedó registrado con su hito', !!inicio,
  JSON.stringify(medios.map((m) => `${m.hito}/${m.estado}`)))
// Lo que de verdad importa: que el archivo SE BAJÓ a Storage propio y que su
// sha256 quedó calculado. La URL de Meta vale 5 minutos y el media_id 7 días:
// si esto no pasa, la prueba del trabajo se pierde.
esperar('el archivo se bajó a Storage propio, con su sha256',
  inicio?.estado === 'DESCARGADO' && /^[0-9a-f]{64}$/.test(inicio?.sha256 ?? ''),
  `${inicio?.estado} · ${inicio?.bucket}/${inicio?.path}`)
esperar('y entró al módulo de rondas como evidencia', !!inicio?.evidencia_id,
  String(inicio?.evidencia_id))
if (inicio?.path) console.log(`      📎 ${inicio.bucket}/${inicio.path}`)
const evidencias = await q(`select tipo, archivo_path, sha256, origen from ronda_evidencias
  where visita_id = $1 order by created_at`, [r.conv.visita_id])
esperar('la evidencia quedó en ronda_evidencias con su huella',
  evidencias.length >= 1 && evidencias.every((e) => /^[0-9a-f]{64}$/.test(e.sha256 ?? '')),
  JSON.stringify(evidencias.map((e) => `${e.tipo}/${e.origen}`)))

/* 11. Elige la primera tarea. */
id = idOfrecido(r.nuevos, 'tarea:') ?? `tarea:${pasos[0].id}`
await inyectar('Elige tarea', { clase: 'lista', waId: WA, idRespuesta: id, tituloRespuesta: 'Revisar extintor' })
r = await respuesta('Elige «Revisar extintor»', `[${id}]`)
esperar('entra en ejecución con la tarea abierta', r.conv.estado === 'EN_EJECUCION', r.conv.estado)
esperar('manda el instructivo', r.nuevos.some((m) => /Revisar extintor/.test((m.payload ?? {}).texto ?? (m.payload ?? {}).cuerpo ?? '')))

/* 12. Una medición escrita a mano: se CONFIRMA antes de guardarla. */
await inyectar('Medición', { clase: 'texto', waId: WA, texto: 'presión 12 bar' })
r = await respuesta('Escribe «presión 12 bar»', 'presión 12 bar')
esperar('propone el valor y pide confirmar',
  r.nuevos.some((m) => /12 bar/.test((m.payload ?? {}).cuerpo ?? '')),
  JSON.stringify(r.nuevos.map((m) => (m.payload ?? {}).cuerpo)))
const respuestasAntes = await q(`select count(*)::int n from ronda_respuestas where visita_id = $1`, [r.conv.visita_id])
esperar('NO la guardó todavía', respuestasAntes[0].n === 0, String(respuestasAntes[0].n))

/* 13. Confirma la medición. */
id = idOfrecido(r.nuevos, 'confirmar:medicion') ?? 'confirmar:medicion:si'
await inyectar('Confirma medición', { clase: 'boton', waId: WA, idRespuesta: id, tituloRespuesta: 'Sí' })
r = await respuesta('Confirma la medición', '[Sí]')
const guardada = await q(`select tipo, valor_numero from ronda_respuestas where visita_id = $1`, [r.conv.visita_id])
esperar('la medición quedó guardada con su valor',
  guardada.some((x) => Number(x.valor_numero) === 12), JSON.stringify(guardada))

/* 14. Una nota de voz: se guarda y se manda a transcribir. */
await inyectar('Nota de voz', { clase: 'audio', waId: WA, mediaId: 'media-voz', voz: true })
r = await respuesta('Manda una nota de voz', '[nota de voz]')
esperar('acusa recibo del audio', r.nuevos.some((m) => /nota de voz/i.test((m.payload ?? {}).texto ?? '')))
const audios = await q(`select voz, estado from whatsapp_medios where conversacion_id = $1 and voz = true`, [r.conv.id])
esperar('el audio quedó guardado (la prueba es el archivo, no la transcripción)', audios.length === 1)

/* 15. Marca la primera tarea como hecha. */
id = `tarea:${pasos[0].id}:hecha`
await inyectar('Tarea hecha', { clase: 'boton', waId: WA, idRespuesta: id, tituloRespuesta: 'Hecha' })
r = await respuesta('Toca «Hecha»', '[Hecha]')
esperar('vuelve a la lista con las tareas que faltan',
  r.nuevos.some((m) => m.tipo === 'LISTA' && ((m.payload ?? {}).secciones ?? [])[0]?.filas?.length === 2))

/* 16. La segunda tarea, también hecha. */
await inyectar('Elige la segunda', { clase: 'lista', waId: WA, idRespuesta: `tarea:${pasos[1].id}` })
await respuesta('Elige «Barrer zona común»', `[tarea 2]`)
await inyectar('Segunda hecha', { clase: 'boton', waId: WA, idRespuesta: `tarea:${pasos[1].id}:hecha`, tituloRespuesta: 'Hecha' })
r = await respuesta('Toca «Hecha»', '[Hecha]')

/* 17. La tercera NO se pudo. */
await inyectar('Elige la tercera', { clase: 'lista', waId: WA, idRespuesta: `tarea:${pasos[2].id}` })
r = await respuesta('Elige «Cambiar bombillo»', '[tarea 3]')
await inyectar('No se pudo', { clase: 'boton', waId: WA, idRespuesta: `tarea:${pasos[2].id}:nopudo`, tituloRespuesta: 'No se pudo' })
r = await respuesta('Toca «No se pudo»', '[No se pudo]')
esperar('pide el motivo con una lista corta',
  r.nuevos.some((m) => m.tipo === 'LISTA' && ((m.payload ?? {}).secciones ?? [])[0]?.filas?.length === 4))

/* 18. El motivo: falta material. Abre novedad y, al no quedar tareas, pide la
       foto de cierre. */
id = idOfrecido(r.nuevos, 'motivo:') ?? `motivo:${pasos[2].id}:Falta material`
await inyectar('Motivo', { clase: 'lista', waId: WA, idRespuesta: id, tituloRespuesta: 'Falta material' })
r = await respuesta('Elige «Falta material»', '[Falta material]')
esperar('lo anota y abre la novedad', r.nuevos.some((m) => /falta material/i.test((m.payload ?? {}).texto ?? '')))
esperar('pide la foto de cierre', r.nuevos.some((m) => /terminado/i.test((m.payload ?? {}).texto ?? '')))
const novedades = await q(`select titulo, clase, estado_destino from ronda_novedades where visita_id = $1`, [r.conv.visita_id])
esperar('la novedad quedó en ronda_novedades', novedades.length >= 1, JSON.stringify(novedades))

/* 19. La foto de cierre. Con ella llega el resumen: es la transición T6 → T7. */
await inyectar('Foto de cierre', { clase: 'imagen', waId: WA, mediaId: 'media-fin', mime: 'image/jpeg' })
r = await respuesta('Foto de cierre', '[foto]')
const resumen = r.nuevos.find((m) => ((m.payload ?? {}).botones ?? []).some((b) => b.id === 'resumen:confirmar'))
esperar('la foto de cierre lleva al resumen', r.conv.estado === 'RESUMEN', r.conv.estado)
esperar('el resumen llegó con Confirmar y Corregir', !!resumen,
  JSON.stringify(r.nuevos.map((m) => m.tipo)))
if (resumen) {
  const cuerpo = (resumen.payload ?? {}).cuerpo ?? ''
  console.log(`\n   ── EL RESUMEN QUE VIO LA PERSONA ──\n${cuerpo.split('\n').map((l) => `   │ ${l}`).join('\n')}`)
  esperar('el resumen dice las tareas hechas', /Hechas/.test(cuerpo))
  esperar('el resumen dice lo que no se pudo, con su motivo', /No se pudo.*Falta material/s.test(cuerpo))
  esperar('el resumen dice las horas y la duración', /\d{2}:\d{2} a \d{2}:\d{2}/.test(cuerpo))
  esperar('el resumen dice la distancia al punto', /del punto/.test(cuerpo))
}

/* 20. Un mensaje suelto en RESUMEN repite la pregunta, acortada, sin confirmar
       nada por su cuenta. */
await inyectar('Mensaje en resumen', { clase: 'texto', waId: WA, texto: 'listo' })
r = await respuesta('Escribe «listo» con el resumen en pantalla', 'listo')
esperar('sigue en RESUMEN: el bot no confirma por nadie', r.conv.estado === 'RESUMEN', r.conv.estado)
const evResumen = await q(`select detalle from ronda_eventos
  where entidad = 'crm_conversaciones' and accion = 'RESUMEN_ENVIADO' and entidad_id = $1`, [r.conv.id])
esperar('el texto EXACTO del resumen quedó guardado como prueba',
  evResumen.length >= 1 && typeof evResumen[0].detalle?.texto === 'string')

/* 21. Confirma el cierre. */
await inyectar('Confirmar', { clase: 'boton', waId: WA, idRespuesta: 'resumen:confirmar', tituloRespuesta: 'Confirmar' })
r = await respuesta('Toca «Confirmar»', '[Confirmar]')
const visita = await uno(`select numero, estado, incompleta_motivo, distancia_metros, dentro_geocerca,
  canal, identidad_metodo, fin_servidor, faltantes from ronda_visitas where id = $1`, [r.conv.visita_id])
esperar('la visita quedó cerrada', ['COMPLETADA', 'INCOMPLETA'].includes(visita?.estado), visita?.estado)
esperar('el canal es WHATSAPP', visita?.canal === 'WHATSAPP', visita?.canal)
esperar('la evidencia por WhatsApp se marca como identidad de BOT',
  visita?.identidad_metodo === 'BOT', visita?.identidad_metodo)
console.log(`   📄 reporte ${visita?.numero} · ${visita?.estado}${visita?.incompleta_motivo ? ` — ${visita.incompleta_motivo}` : ''}`)

/* ─────────── Lo que no se ve en la conversación pero hay que probar ─────────── */

console.log('\n══════════ CONTROLES QUE NO SE VEN EN EL CHAT ══════════')

/* A. Firma inválida: 403 y nada encolado. */
paso++
const cuerpoFalso = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'falso' }] })
const malaFirma = await fetch(`${BASE}/api/whatsapp/webhook`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': 'sha256=' + 'a'.repeat(64) },
  body: cuerpoFalso,
})
console.log(`\n${paso}. Golpe al webhook con firma inválida`)
esperar('responde 403', malaFirma.status === 403, String(malaFirma.status))
const rechazos = await q(`select motivo from whatsapp_eventos_rechazados
  where recibido_at > now() - interval '2 minutes' order by id desc limit 1`)
esperar('queda registrado el rechazo, SIN el cuerpo', rechazos[0]?.motivo === 'FIRMA_INVALIDA',
  JSON.stringify(rechazos))

/* B. Sin firma: 403. */
paso++
const sinFirma = await fetch(`${BASE}/api/whatsapp/webhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: cuerpoFalso,
})
console.log(`\n${paso}. Golpe al webhook sin firma`)
esperar('responde 403', sinFirma.status === 403, String(sinFirma.status))

/* C. El reto de suscripción. */
paso++
const verify = leerEnv('WHATSAPP_WEBHOOK_VERIFY_TOKEN') || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN
console.log(`\n${paso}. Reto de suscripción (GET)`)
if (verify) {
  const bueno = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(verify)}&hub.challenge=1158201444`)
  esperar('con el token correcto devuelve 200 y el challenge crudo',
    bueno.status === 200 && (await bueno.text()) === '1158201444')
  const malo = await fetch(`${BASE}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=equivocado&hub.challenge=x`)
  esperar('con el token equivocado devuelve 403', malo.status === 403, String(malo.status))
} else {
  console.log('   (sin WHATSAPP_WEBHOOK_VERIFY_TOKEN en el entorno: no se puede probar)')
}

/* D. Idempotencia: el MISMO wamid cinco veces deja un solo efecto. */
paso++
const { createHash } = await import('crypto')
void createHash
const wamidFijo = 'wamid.' + Buffer.from('IDEMPOTENCIA-F9').toString('base64')
const antesEventos = (await q(`select count(*)::int n from whatsapp_eventos where dedup_clave = $1`, [wamidFijo]))[0].n
for (let i = 0; i < 5; i++) {
  await inyectar('Idempotencia', { clase: 'texto', waId: WA, texto: 'ayuda', wamid: wamidFijo }, { procesar: i === 4 })
  paso-- // no cuenta como paso de la conversación
}
paso++
console.log(`\n${paso}. El mismo wamid cinco veces (Meta reintenta 7 días)`)
const eventos = await q(`select count(*)::int n from whatsapp_eventos where dedup_clave = $1`, [wamidFijo])
esperar('una sola fila en whatsapp_eventos', eventos[0].n === 1, `antes ${antesEventos}, ahora ${eventos[0].n}`)
const entrantes = await q(`select count(*)::int n from crm_mensajes where wamid = $1`, [wamidFijo])
esperar('un solo mensaje entrante', entrantes[0].n === 1, String(entrantes[0].n))

/* E. Fuera de la ventana de 24 h, sin plantilla, no sale nada. */
paso++
console.log(`\n${paso}. Fuera de la ventana de 24 horas`)
const conv = await uno(`select id from crm_conversaciones where cuenta_id = $1 and wa_id = $2`, [cuenta.id, WA])
await cliente.query(`update crm_conversaciones set ultimo_entrante_at = now() - interval '30 hours',
  ventana_vence_at = now() - interval '6 hours' where id = $1`, [conv.id])
const libre = await uno(`select estado, omitido_motivo from whatsapp_encolar(
  p_conversacion => $1, p_texto => 'esto no debería salir', p_iniciado_por => 'BOT')`, [conv.id])
esperar('un mensaje libre queda OMITIDO_VENTANA', libre.estado === 'OMITIDO_VENTANA', libre.estado)
console.log(`      ↳ ${libre.omitido_motivo}`)

const sinAprobar = await uno(`select estado, omitido_motivo from whatsapp_encolar(
  p_conversacion => $1, p_plantilla => 'visita_pendiente_cierre', p_iniciado_por => 'BOT')`, [conv.id])
esperar('una plantilla SIN APROBAR también se salta', sinAprobar.estado === 'OMITIDO_PLANTILLA', sinAprobar.estado)
console.log(`      ↳ ${sinAprobar.omitido_motivo}`)

await cliente.query(`update whatsapp_plantillas set estado = 'APPROVED' where nombre = 'visita_pendiente_cierre'`)
const aprobada = await uno(`select estado, es_plantilla, plantilla_nombre from whatsapp_encolar(
  p_conversacion => $1, p_plantilla => 'visita_pendiente_cierre',
  p_variables => '["Prueba","K7M-4QX9","Porteria principal","hoy"]'::jsonb, p_iniciado_por => 'BOT')`, [conv.id])
esperar('una plantilla APPROVED sí sale fuera de la ventana',
  aprobada.estado === 'PENDIENTE' && aprobada.es_plantilla === true, aprobada.estado)

/* F. Fuera de la jornada, el bot no inicia conversación. */
paso++
console.log(`\n${paso}. Fuera de la jornada (art. 3 de la Ley 2191 de 2022)`)
await cliente.query(`update crm_conversaciones set ultimo_entrante_at = now(),
  ventana_vence_at = now() + interval '24 hours' where id = $1`, [conv.id])
await cliente.query(`update grupo_reglas set mensajeria_desde = '00:00', mensajeria_hasta = '00:01' where grupo_id = $1`, [g.id])
const deNoche = await uno(`select estado, omitido_motivo from whatsapp_encolar(
  p_conversacion => $1, p_texto => 'recordatorio nocturno', p_iniciado_por => 'BOT')`, [conv.id])
esperar('un mensaje iniciado por el BOT queda OMITIDO_JORNADA', deNoche.estado === 'OMITIDO_JORNADA', deNoche.estado)
console.log(`      ↳ ${deNoche.omitido_motivo}`)
const contestando = await uno(`select estado from whatsapp_encolar(
  p_conversacion => $1, p_texto => 'te contesto lo que preguntaste', p_iniciado_por => 'RESPUESTA')`, [conv.id])
esperar('pero CONTESTARLE a quien escribió sí pasa', contestando.estado === 'PENDIENTE', contestando.estado)
await cliente.query(`update grupo_reglas set mensajeria_desde = '00:00', mensajeria_hasta = '23:59' where grupo_id = $1`, [g.id])

/* G. El caudal de la cola: 200 mensajes encolados no se mandan de golpe. */
paso++
console.log(`\n${paso}. Control de caudal de la cola de salida`)
for (let i = 0; i < 60; i++) {
  await cliente.query(`select whatsapp_encolar(p_conversacion => $1, p_texto => $2,
    p_iniciado_por => 'RESPUESTA', p_prioridad => 9)`, [conv.id, `aviso masivo ${i}`])
}
const t0 = Date.now()
const salidaCron = await fetch(`${BASE}/api/cron/whatsapp-salida`, {
  headers: CRON ? { Authorization: `Bearer ${CRON}` } : {},
})
const resCron = await salidaCron.json().catch(() => null)
const transcurrido = (Date.now() - t0) / 1000
const mandados = (resCron?.simulados ?? 0) + (resCron?.enviados ?? 0)
console.log(`      ${mandados} mensajes en ${transcurrido.toFixed(1)} s`)
esperar('el cron responde 200', salidaCron.status === 200, String(salidaCron.status))
esperar('no se pasa del caudal permitido (≈15 msj/s)',
  mandados === 0 || mandados / Math.max(transcurrido, 0.001) <= 20,
  `${(mandados / Math.max(transcurrido, 0.001)).toFixed(1)} msj/s`)
// La cola ordena por prioridad: quien está parado en un punto esperando va
// antes que un aviso masivo. Se comprueba con las dos filas encoladas AL MISMO
// TIEMPO, una con prioridad 1 y otra con 9.
await cliente.query(`select whatsapp_encolar(p_conversacion => $1, p_texto => 'aviso de cola',
  p_iniciado_por => 'RESPUESTA', p_prioridad => 9)`, [conv.id])
await cliente.query(`select whatsapp_encolar(p_conversacion => $1, p_texto => 'respuesta urgente',
  p_iniciado_por => 'RESPUESTA', p_prioridad => 1)`, [conv.id])
await fetch(`${BASE}/api/cron/whatsapp-salida`, { headers: CRON ? { Authorization: `Bearer ${CRON}` } : {} })
const orden = await q(`select texto, prioridad, enviado_at from crm_mensajes
  where conversacion_id = $1 and texto in ('aviso de cola','respuesta urgente')
  order by enviado_at nulls last`, [conv.id])
console.log('      ' + orden.map((o) => `pri ${o.prioridad} «${o.texto}»`).join('  →  '))
esperar('la prioridad 1 sale antes que la 9',
  orden.length === 2 && orden[0].prioridad === 1, JSON.stringify(orden.map((o) => o.prioridad)))

/* H. Los crons responden y exigen el secreto. */
paso++
console.log(`\n${paso}. Los tres crons`)
for (const ruta of ['whatsapp-entrada', 'whatsapp-salida', 'whatsapp-vencimientos']) {
  const conSecreto = await fetch(`${BASE}/api/cron/${ruta}`, { headers: CRON ? { Authorization: `Bearer ${CRON}` } : {} })
  esperar(`/api/cron/${ruta} responde 200`, conSecreto.status === 200, String(conSecreto.status))
  if (CRON) {
    const sinSecreto = await fetch(`${BASE}/api/cron/${ruta}`)
    esperar(`/api/cron/${ruta} exige el secreto`, sinSecreto.status === 401, String(sinSecreto.status))
  }
}

/* ─────────────────────────────── Resumen ──────────────────────────────────── */

console.log('\n══════════ LO QUE QUEDÓ EN LA BASE ══════════')
const conteos = await q(`
  select 'whatsapp_eventos' t, count(*)::int n from whatsapp_eventos where wa_id = $1
  union all select 'crm_mensajes entrantes', count(*)::int from crm_mensajes m
    join crm_conversaciones c on c.id = m.conversacion_id where c.wa_id = $1 and m.direccion = 'ENTRANTE'
  union all select 'crm_mensajes salientes', count(*)::int from crm_mensajes m
    join crm_conversaciones c on c.id = m.conversacion_id where c.wa_id = $1 and m.direccion = 'SALIENTE'
  union all select 'omitidos', count(*)::int from crm_mensajes m
    join crm_conversaciones c on c.id = m.conversacion_id where c.wa_id = $1 and m.estado like 'OMITIDO%'
  union all select 'whatsapp_medios', count(*)::int from whatsapp_medios md
    join crm_conversaciones c on c.id = md.conversacion_id where c.wa_id = $1
  union all select 'ronda_respuestas', count(*)::int from ronda_respuestas where visita_id = $2
  union all select 'ronda_novedades', count(*)::int from ronda_novedades where visita_id = $2
  union all select 'ronda_eventos del bot', count(*)::int from ronda_eventos
    where canal = 'WHATSAPP' and created_at > now() - interval '30 minutes'
`, [WA, r.conv.visita_id])
for (const c of conteos) console.log(`   ${String(c.n).padStart(4)}  ${c.t}`)

const transiciones = await q(`select accion, detalle->>'estado_anterior' de, detalle->>'disparador' por
  from ronda_eventos where entidad = 'crm_conversaciones' and entidad_id = $1
  order by id`, [conv.id])
console.log('\n   Transiciones registradas:')
for (const t of transiciones) console.log(`     ${t.de ?? '—'} → ${t.accion}   (${t.por})`)

console.log('\n══════════ RESULTADO ══════════')
if (fallos.length === 0) {
  console.log('Todo bien: la conversación completa se recorrió de punta a punta.')
} else {
  console.log(`${fallos.length} problema(s):`)
  for (const f of fallos) console.log(`  · ${f}`)
}

if (!process.argv.includes('--dejar')) {
  await limpiar()
  console.log('\nDatos de muestra borrados.')
} else {
  console.log('\nDatos de muestra CONSERVADOS (--dejar). Para borrarlos: node scripts/simular-whatsapp.mjs --limpiar')
}

await cliente.end()
process.exit(fallos.length === 0 ? 0 : 1)

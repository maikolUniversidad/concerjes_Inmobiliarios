// Verificación de F10 (mensajería masiva individual, menú y próxima ubicación)
// contra la base de datos REAL.
//
// Todo corre dentro de BEGIN … ROLLBACK: no deja ni una fila. Monta un contrato,
// dos sedes, varias personas con números INVENTADOS y fuera de rangos reales,
// y recorre la audiencia, el escalonado, la jornada, el encolado, el espejo de
// estado y el menú.
//
// Uso:  NODE_OPTIONS=--use-system-ca node scripts/probar-puntos-qr-f10.mjs
//
// TRAMPA, la misma que anotó F8: dentro de una transacción NOW() es la hora de
// INICIO y no avanza. Por eso las jornadas se calculan a partir de NOW() con
// desplazamientos (±1 h para «dentro», +2/+3 h para «fuera») en vez de escribir
// horas fijas, y las esperas se simulan moviendo `programado_para` a mano.
import { createRequire } from 'module'
import { readFileSync } from 'fs'
const require = createRequire(import.meta.url)
const { Client } = require('pg')
const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const c = new Client({
  connectionString: env.match(/^DIRECT_URL="?([^"\n]+)"?/m)[1].trim(),
  ssl: { rejectUnauthorized: false },
})
await c.connect()

let ok = 0
let mal = 0
const esperar = (nombre, cond, extra = '') => {
  if (cond) {
    ok++
    console.log('  OK  ', nombre)
  } else {
    mal++
    console.log('  MAL ', nombre, extra === '' ? '' : JSON.stringify(extra))
  }
}
const uno = async (sql, args) => (await c.query(sql, args)).rows[0]
const todos = async (sql, args) => (await c.query(sql, args)).rows
const titulo = (t) => console.log(`\n── ${t}`)
// node-postgres devuelve un Date, y Date.parse(Date) pierde los milisegundos
// (pasa por toString(), que tiene resolución de segundos). El escalonado se mide
// en medios segundos, así que hay que leerlos exactos.
const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v))
// Un error dentro de una transacción la ABORTA. Los fallos que se esperan a
// propósito van entre SAVEPOINTs para que la verificación pueda seguir.
let nSp = 0
const fallo = async (sql, args) => {
  const sp = `sp${++nSp}`
  await c.query(`SAVEPOINT ${sp}`)
  try {
    await c.query(sql, args)
    await c.query(`RELEASE SAVEPOINT ${sp}`)
    return null
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${sp}`)
    return e.message
  }
}

await c.query('BEGIN')
try {
  // ═══════════════════════════════════════════════════════════════════════════
  // Montaje
  // ═══════════════════════════════════════════════════════════════════════════
  const g = await uno(`insert into grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    values ('F10-PRUEBA', 'Contrato de prueba F10', 'VIGENTE', current_date - 10, current_date + 365)
    returning id`)
  const gOtro = await uno(`insert into grupos_contrato (codigo, nombre, estado, vigencia_desde, vigencia_hasta)
    values ('F10-OTRO', 'Otro contrato F10', 'VIGENTE', current_date - 10, current_date + 365)
    returning id`)
  // La jornada del contrato se compara en hora de BOGOTÁ (whatsapp_jornada hace
  // `AT TIME ZONE`), así que la franja de prueba se calcula en esa zona: un
  // `(now())::time` saldría en la hora del servidor y quedaría corrido cinco
  // horas. Esta ayuda deja una franja que CONTIENE al momento actual, o que lo
  // excluye, según los desplazamientos que se le pasen.
  const jornada = (grupo, desdeH, hastaH) => c.query(
    `insert into grupo_reglas (grupo_id, permite_whatsapp, mensajeria_desde, mensajeria_hasta)
     values ($1, true,
             ((now() at time zone 'America/Bogota') + ($2 || ' hours')::interval)::time,
             ((now() at time zone 'America/Bogota') + ($3 || ' hours')::interval)::time)
     on conflict (grupo_id) do update
        set permite_whatsapp = true,
            mensajeria_desde = excluded.mensajeria_desde,
            mensajeria_hasta = excluded.mensajeria_hasta`,
    [grupo, String(desdeH), String(hastaH)])
  await jornada(g.id, -1, 1)
  await jornada(gOtro.id, -1, 1)

  const s1 = await uno(`insert into sedes (grupo_id, nombre, ciudad, activo, lat, lng)
    values ($1, 'Sede A F10', 'Bogota', true, 4.65, -74.10) returning id`, [g.id])
  const s2 = await uno(`insert into sedes (grupo_id, nombre, ciudad, activo, lat, lng)
    values ($1, 'Sede B F10', 'Bogota', true, 4.66, -74.11) returning id`, [g.id])
  const sOtro = await uno(`insert into sedes (grupo_id, nombre, ciudad, activo, lat, lng)
    values ($1, 'Sede de otro contrato', 'Bogota', true, 4.67, -74.12) returning id`, [gOtro.id])

  // Personas de muestra. Documentos y números INVENTADOS (+57 300 000 00xx no
  // existe) y nombres de fantasía: este repositorio es público.
  //  p1 · sede A, CONSERJE,  con canal verificado y consentimiento  → entra
  //  p2 · sede A, SUPERVISOR,con canal verificado y consentimiento  → entra
  //  p3 · sede B, CONSERJE,  con canal verificado SIN consentimiento→ excluida
  //  p4 · sede A, CONSERJE,  SIN canal                              → excluida
  //  p5 · sede A, CONSERJE,  canal bloqueado + consentimiento       → excluida
  //  p6 · sede A, CONSERJE,  RETIRADO, canal y consentimiento       → excluida
  //  p7 · sede de OTRO contrato, con canal y consentimiento         → excluida
  const persona = async (n, cargo, sede, estado = 'ACTIVO') =>
    (await uno(`insert into personas (tipo_doc, documento, nombres, apellidos, cargo, sede_id, estado)
      values ('CC', $1, 'Prueba', $2, $3, $4, $5) returning id`,
      [`90000010${n}`, `F10-${n}`, cargo, sede, estado])).id
  const canal = async (pid, n, bloqueado = false) =>
    (await uno(`insert into persona_canales
       (persona_id, canal, valor, wa_id, verificado, verificado_at, verificacion_metodo, principal,
        bloqueado_at, bloqueo_motivo)
       values ($1, 'WHATSAPP', $2, $3, true, now(), 'CONSOLA', true, $4, $5) returning id`,
      [pid, `+5730000001${n}`, `5730000001${n}`,
       bloqueado ? new Date().toISOString() : null,
       bloqueado ? 'Canal inhabilitado en la prueba' : null])).id
  const consentir = (pid) =>
    c.query(`insert into persona_consentimientos
       (persona_id, tipo, otorgado, texto_version, texto_hash, canal)
       values ($1, 'WHATSAPP', true, 'f10-prueba', 'f10-prueba-hash', 'WHATSAPP')`, [pid])

  const p1 = await persona('01', 'Conserje', s1.id)
  const p2 = await persona('02', 'Supervisor', s1.id)
  const p3 = await persona('03', 'Conserje', s2.id)
  const p4 = await persona('04', 'Conserje', s1.id)
  const p5 = await persona('05', 'Conserje', s1.id)
  const p6 = await persona('06', 'Conserje', s1.id, 'RETIRADO')
  const p7 = await persona('07', 'Conserje', sOtro.id)
  await canal(p1, '01'); await consentir(p1)
  await canal(p2, '02'); await consentir(p2)
  await canal(p3, '03')                       // sin consentimiento
  /* p4 sin canal */
  await canal(p5, '05', true); await consentir(p5)
  await canal(p6, '06'); await consentir(p6)
  await canal(p7, '07'); await consentir(p7)

  const cuenta = await uno(`select id, throughput_mps from whatsapp_cuentas where alias = 'simulador'`)
  // Una plantilla APPROVED de prueba: fuera de la ventana de 24 h sólo sale una
  // aprobada, y las diez de F9 están PENDIENTE porque nadie las aprobó en Meta
  // todavía. Se crea aquí y muere con el ROLLBACK.
  await c.query(`insert into whatsapp_plantillas
      (nombre, categoria, idioma, cuerpo, variables, estado, meta_id, proposito)
      values ('zzf10_prueba', 'UTILITY', 'es_CO', 'Hola {{1}}. {{2}}',
              '[{"pos":1,"ejemplo":"Ana"},{"pos":2,"ejemplo":"Aviso"}]'::jsonb,
              'APPROVED', 'zzf10', 'Plantilla aprobada sólo para la verificación de F10.')`)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('1. Estructura y alcance (§2.4)')
  // ═══════════════════════════════════════════════════════════════════════════
  const cols = await todos(`select table_name, column_name, is_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('crm_envios','crm_envio_destinos','crm_menu_opciones')
     and column_name in ('grupo_id','sede_id')`)
  const col = (t, n) => cols.find((x) => x.table_name === t && x.column_name === n)
  esperar('crm_envios.grupo_id es NOT NULL', col('crm_envios', 'grupo_id')?.is_nullable === 'NO')
  esperar('crm_envio_destinos.grupo_id es NOT NULL', col('crm_envio_destinos', 'grupo_id')?.is_nullable === 'NO')
  esperar('crm_menu_opciones.grupo_id es NULLABLE (NULL = todos los contratos)',
    col('crm_menu_opciones', 'grupo_id')?.is_nullable === 'YES')
  esperar('crm_envios NO lleva sede_id (la sede es un filtro, no el eje)', !col('crm_envios', 'sede_id'))
  esperar('crm_envio_destinos NO lleva sede_id', !col('crm_envio_destinos', 'sede_id'))

  // Las tablas de F11 pueden existir —esa fase corre en paralelo—, así que lo
  // que se comprueba es que la migración de F10 no las toque: se lee el archivo.
  const sqlF10 = readFileSync(
    new URL('../supabase/migrations/20261028001100_puntos_qr_f10_masivo_menu.sql', import.meta.url), 'utf8')
  // Sin los comentarios: el encabezado del archivo NOMBRA las tablas de F11
  // justamente para decir que no las crea.
  const sinComentarios = sqlF10.replace(/^\s*--.*$/gm, '')
  const deF11 = ['crm_casos', 'crm_etiquetas', 'crm_caso_etiquetas', 'crm_asignaciones',
                 'crm_sla', 'crm_sla_reglas'].filter((t) => sinComentarios.includes(t))
  esperar('la migración de F10 no toca ninguna tabla de F11', deF11.length === 0, deF11)
  const fuera = ['mant_', 'activo_', 'pqrs_', 'persona_ubicacion_']
    .filter((p) => new RegExp(`(CREATE|ALTER|DROP)\\s+TABLE[^;]*${p}`, 'i').test(sinComentarios))
  esperar('y no crea ni altera tablas de otras fases (mant_, activo_, pqrs_, persona_ubicacion_)',
    fuera.length === 0, fuera)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('2. La audiencia: una fila por persona, con su motivo de exclusión')
  // ═══════════════════════════════════════════════════════════════════════════
  const envio = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, tipo, audiencia_alcance, texto, plantilla_nombre,
       variables, costo_unitario)
      values ($1, $2, 'Aviso de prueba F10', 'AVISO', 'CONTRATO',
              'Hola {nombre}, novedad en {sede}.', null, '[]'::jsonb, 25.5)
      returning *`, [g.id, cuenta.id])
  const res = await uno(`select public.crm_envio_resolver($1) as r`, [envio.id])
  const r = res.r
  esperar('entran las 2 personas con canal verificado y consentimiento', r.destinos === 2, r)
  esperar('quedan 4 excluidas del contrato', r.excluidos === 4, r)
  esperar('cuenta la exclusión por falta de opt-in', r.exclusiones?.SIN_CONSENTIMIENTO === 1, r.exclusiones)
  esperar('cuenta la exclusión por no tener WhatsApp verificado', r.exclusiones?.SIN_CANAL === 1, r.exclusiones)
  esperar('cuenta la exclusión por canal bloqueado', r.exclusiones?.CANAL_BLOQUEADO === 1, r.exclusiones)
  esperar('cuenta la exclusión por persona retirada', r.exclusiones?.PERSONA_INACTIVA === 1, r.exclusiones)

  const dest = await todos(`select persona_id, estado, exclusion_motivo, canal_valor
    from crm_envio_destinos where envio_id = $1 order by estado, persona_id`, [envio.id])
  esperar('hay exactamente una fila por persona del contrato', dest.length === 6, dest.length)
  esperar('la persona de otro contrato NO aparece',
    !dest.some((d) => d.persona_id === p7))
  esperar('un destino que entra lleva copiado su número',
    dest.filter((d) => d.estado === 'PENDIENTE').every((d) => (d.canal_valor ?? '').startsWith('+57')))
  esperar('un destino excluido no exige número',
    dest.filter((d) => d.estado === 'EXCLUIDO').some((d) => d.canal_valor === null))

  const envioTot = await uno(`select total_destinos, total_excluidos, costo_estimado, estado
    from crm_envios where id = $1`, [envio.id])
  esperar('el envío guarda los totales calculados en SQL',
    envioTot.total_destinos === 2 && envioTot.total_excluidos === 4, envioTot)
  esperar('el costo estimado es la tarifa por los destinos (§4.1)',
    Number(envioTot.costo_estimado) === 51, envioTot.costo_estimado)
  esperar('el envío pasa a CALCULADO', envioTot.estado === 'CALCULADO', envioTot.estado)

  // Resolver dos veces no duplica (la regla «una fila por persona»).
  await c.query(`select public.crm_envio_resolver($1)`, [envio.id])
  const n2 = await uno(`select count(*)::int as n from crm_envio_destinos where envio_id = $1`, [envio.id])
  esperar('recalcular la audiencia no duplica destinos', n2.n === 6, n2.n)

  const dup = await c.query(`insert into crm_envio_destinos (envio_id, grupo_id, persona_id, canal_valor, estado)
    values ($1, $2, $3, '+573000000199', 'PENDIENTE') on conflict do nothing returning id`,
    [envio.id, g.id, p1])
  esperar('el índice único impide una segunda fila para la misma persona', dup.rowCount === 0)

  // ── Audiencia por SEDE ──────────────────────────────────────────────────────
  const eSede = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_sedes, texto)
      values ($1, $2, 'Solo sede B', 'SEDES', ARRAY[$3::uuid], 'Aviso de sede') returning id`,
    [g.id, cuenta.id, s2.id])
  const rSede = (await uno(`select public.crm_envio_resolver($1) as r`, [eSede.id])).r
  esperar('la audiencia por sede sólo trae la sede pedida',
    rSede.destinos === 0 && rSede.excluidos === 1, rSede)

  // ── Audiencia por ROL (cargo de nómina) ─────────────────────────────────────
  const eCargo = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_cargos, texto)
      values ($1, $2, 'Solo supervisores', 'CONTRATO', ARRAY['SUPERVISOR'], 'Aviso a supervisores')
      returning id`, [g.id, cuenta.id])
  const rCargo = (await uno(`select public.crm_envio_resolver($1) as r`, [eCargo.id])).r
  esperar('la audiencia por rol filtra por el cargo de la nómina', rCargo.destinos === 1, rCargo)
  const quienCargo = await uno(`select persona_id from crm_envio_destinos
    where envio_id = $1 and estado = 'PENDIENTE'`, [eCargo.id])
  esperar('y es la persona del cargo pedido', quienCargo.persona_id === p2)

  // ── Audiencia por PERSONAS sueltas, con el guardia del contrato ─────────────
  const ePers = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, texto)
      values ($1, $2, 'Dos personas', 'PERSONAS', ARRAY[$3::uuid, $4::uuid], 'Aviso puntual')
      returning id`, [g.id, cuenta.id, p1, p7])
  const rPers = (await uno(`select public.crm_envio_resolver($1) as r`, [ePers.id])).r
  esperar('las personas sueltas entran, y la de otro contrato queda fuera',
    rPers.destinos === 1 && rPers.exclusiones?.FUERA_DEL_CONTRATO === 1, rPers)

  // ── Audiencia por TURNO (F8) ────────────────────────────────────────────────
  const eTurno = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_turno, texto)
      values ($1, $2, 'Los que están en turno', 'CONTRATO', 'EN_TURNO', 'Aviso en turno')
      returning id`, [g.id, cuenta.id])
  const rSinTurno = (await uno(`select public.crm_envio_resolver($1) as r`, [eTurno.id])).r
  esperar('sin turnos abiertos, la audiencia EN_TURNO es vacía',
    rSinTurno.destinos === 0 && rSinTurno.excluidos === 0, rSinTurno)
  await c.query(`insert into ronda_turnos (persona_id, grupo_id, sede_id, inicio_at, fin_previsto_at, estado)
    values ($1, $2, $3, now() - interval '1 hour', now() + interval '7 hours', 'ABIERTO')`, [p1, g.id, s1.id])
  const rConTurno = (await uno(`select public.crm_envio_resolver($1) as r`, [eTurno.id])).r
  esperar('con un turno abierto, EN_TURNO trae a esa persona', rConTurno.destinos === 1, rConTurno)

  // ── Audiencia por LISTA del directorio ──────────────────────────────────────
  await c.query(`insert into directorio_listas (codigo, nombre, descripcion, uso)
    values ('F10-LISTA', 'Lista de prueba F10', 'Para la verificación de F10', 'Pruebas')`)
  await c.query(`insert into directorio_contactos (lista_codigo, nombre, telefono, correo)
    values ('F10-LISTA', 'Contacto de prueba', '+573000000101', null)`)
  const eLista = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_lista, texto)
      values ($1, $2, 'Por lista', 'LISTA', 'F10-LISTA', 'Aviso por lista') returning id`,
    [g.id, cuenta.id])
  const rLista = (await uno(`select public.crm_envio_resolver($1) as r`, [eLista.id])).r
  esperar('la lista del directorio se cruza por teléfono con un canal verificado',
    rLista.destinos === 1, rLista)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('3. El escalonado: el ritmo del número, no un envío de golpe')
  // ═══════════════════════════════════════════════════════════════════════════
  // Un envío con 30 personas de verdad (una fila por persona, que es la regla)
  // y un caudal bajo, para que el reparto de horas se vea en segundos enteros.
  await c.query(`insert into personas (tipo_doc, documento, nombres, apellidos, cargo, sede_id, estado)
    select 'CC', '9000002' || lpad(i::text, 2, '0'), 'Prueba', 'F10R' || i, 'Operario', $1, 'ACTIVO'
      from generate_series(1, 30) i`, [s1.id])
  const eRitmo = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, texto,
       escalon_mps, estado)
      values ($1, $2, 'Envío grande', 'PERSONAS', ARRAY[$3::uuid], 'Aviso', 2, 'CALCULADO')
      returning id`, [g.id, cuenta.id, p1])
  await c.query(`insert into crm_envio_destinos (envio_id, grupo_id, persona_id, canal_valor, estado, created_at)
    select $1, $2, pe.id, '+5730000002' || lpad(row_number() over (order by pe.documento)::text, 2, '0'),
           'PENDIENTE', now() + (row_number() over (order by pe.documento) * interval '1 millisecond')
      from personas pe
     where pe.documento like '9000002%' and pe.apellidos like 'F10R%'`, [eRitmo.id, g.id])
  const ritmo = await todos(`select programado_para from crm_envio_destinos
    where envio_id = $1 order by created_at limit 5`, [eRitmo.id])
  esperar('antes de aprobar, los destinos no tienen hora',
    ritmo.every((x) => x.programado_para === null))

  await c.query(`select public.crm_envio_aprobar($1, null, 2)`, [eRitmo.id])
  const horas = await todos(`select programado_para, created_at from crm_envio_destinos
    where envio_id = $1 order by created_at`, [eRitmo.id])
  const t0 = ms(horas[0].programado_para)
  const t29 = ms(horas[29].programado_para)
  esperar('aprobar reparte la hora de cada destino', horas.every((h) => h.programado_para !== null))
  esperar('a 2 mensajes por segundo, 30 destinos se reparten en ~14,5 s',
    Math.abs((t29 - t0) / 1000 - 14.5) < 0.2, (t29 - t0) / 1000)
  const saltos = horas.slice(1).map((h, i) => ms(h.programado_para) - ms(horas[i].programado_para))
  esperar('el intervalo entre destinos es 1/mps y es constante',
    saltos.every((d) => Math.abs(d - 500) < 2), saltos.slice(0, 3))

  // El tope nunca puede superar el caudal del número.
  const eTope = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, texto, escalon_mps, estado)
      values ($1, $2, 'Pide más caudal del que hay', 'PERSONAS', ARRAY[$3::uuid], 'Aviso', 20, 'CALCULADO')
      returning id`, [g.id, cuenta.id, p2])
  await c.query(`insert into crm_envio_destinos (envio_id, grupo_id, persona_id, canal_valor, estado)
    values ($1, $2, $3, '+573000000102', 'PENDIENTE')`, [eTope.id, g.id, p2])
  const ev = await uno(`select id from public.crm_envio_aprobar($1, null, 15)`, [eTope.id])
  const evDet = await uno(`select detalle from ronda_eventos
    where entidad = 'crm_envios' and entidad_id = $1 and accion = 'ENVIO_APROBADO'`, [eTope.id])
  esperar('el caudal pedido se recorta al tope de la aplicación',
    Number(evDet.detalle.mps) === 15, evDet.detalle.mps)
  esperar('aprobar deja su rastro en la auditoría', ev.id === eTope.id)

  const vacio = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_sedes, texto, estado)
      values ($1, $2, 'Audiencia vacía', 'SEDES', ARRAY[$3::uuid], 'Aviso', 'CALCULADO') returning id`,
    [g.id, cuenta.id, s2.id])
  const falloVacio = await fallo(`select public.crm_envio_aprobar($1)`, [vacio.id])
  esperar('un envío sin nadie a quien escribirle no se puede aprobar',
    (falloVacio ?? '').includes('vacía'), falloVacio)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('4. La jornada (Ley 2191): fuera de ella se aplaza, no se manda')
  // ═══════════════════════════════════════════════════════════════════════════
  const ventanaDentro = await uno(`select public.crm_envio_siguiente_ventana($1, $2) as v`, [p1, g.id])
  esperar('dentro de la jornada, la siguiente ventana es AHORA',
    Math.abs(ms(ventanaDentro.v) - Date.now()) < 60_000, ventanaDentro.v)

  // Se mueve la jornada del contrato a una franja que NO contiene a NOW().
  await jornada(g.id, 2, 3)
  const ventanaFuera = await uno(`select public.crm_envio_siguiente_ventana($1, $2) as v`, [p1, g.id])
  const faltan = (ms(ventanaFuera.v) - Date.now()) / 3600_000
  esperar('fuera de la jornada, la siguiente ventana es la próxima apertura',
    faltan > 1.9 && faltan < 2.2, faltan)

  const sinJornada = await uno(`select public.crm_envio_siguiente_ventana($1, $2) as v`, [p6, g.id])
  esperar('una persona retirada no tiene ventana a la que aplazar (NULL)', sinJornada.v === null, sinJornada.v)

  // El lote, con la jornada cerrada: tiene que APLAZAR y no encolar.
  const eJor = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, texto, estado,
       programado_para)
      values ($1, $2, 'Fuera de jornada', 'PERSONAS', ARRAY[$3::uuid], 'Hola {nombre}', 'CALCULADO', now())
      returning id`, [g.id, cuenta.id, p1])
  await c.query(`select public.crm_envio_resolver($1)`, [eJor.id])
  await c.query(`select public.crm_envio_aprobar($1)`, [eJor.id])
  const lote1 = (await uno(`select public.crm_envio_tomar_lote(50) as r`)).r
  esperar('con la jornada cerrada el lote no encola nada', lote1.encolados === 0, lote1)
  esperar('y aplaza lo que tocaba', lote1.aplazados >= 1, lote1)
  const dJor = await uno(`select estado, programado_para, aplazos, jornada, mensaje_id
    from crm_envio_destinos where envio_id = $1`, [eJor.id])
  esperar('el destino queda APLAZADO', dJor.estado === 'APLAZADO', dJor.estado)
  esperar('aplazado a la siguiente ventana, no a dentro de un rato',
    (ms(dJor.programado_para) - Date.now()) / 3600_000 > 1.9, dJor.programado_para)
  esperar('no se creó ningún mensaje al aplazar', dJor.mensaje_id === null)
  esperar('guarda con qué jornada se decidió y de qué fuente',
    dJor.jornada?.fuente === 'CONTRATO', dJor.jornada)
  const evJor = await uno(`select detalle, accion from ronda_eventos
    where entidad = 'crm_envio_destinos' and accion = 'ENVIO_APLAZADO_JORNADA' order by id desc limit 1`)
  esperar('el aplazamiento queda en la auditoría', evJor?.accion === 'ENVIO_APLAZADO_JORNADA', evJor)

  // La misma situación, pero marcada como EMERGENCIA: sí sale.
  const admin = await uno(`select id from usuarios order by created_at limit 1`)
  const eEmerg = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, texto, estado,
       es_emergencia, emergencia_por, emergencia_motivo, programado_para)
      values ($1, $2, 'Emergencia', 'PERSONAS', ARRAY[$3::uuid], 'Evacuación en {sede}', 'CALCULADO',
              true, $4, 'Simulacro de evacuación de la prueba F10', now())
      returning id`, [g.id, cuenta.id, p2, admin.id])
  // Con plantilla aprobada: fuera de la ventana de 24 h, ni una emergencia sale
  // sin plantilla, y eso también hay que verlo (se prueba abajo).
  await c.query(`update crm_envios set plantilla_nombre = 'zzf10_prueba',
      variables = '["{nombre}","Evacuación en {sede}"]'::jsonb where id = $1`, [eEmerg.id])
  await c.query(`select public.crm_envio_resolver($1)`, [eEmerg.id])
  await c.query(`select public.crm_envio_aprobar($1)`, [eEmerg.id])
  const loteEmerg = (await uno(`select public.crm_envio_tomar_lote(50) as r`)).r
  esperar('una emergencia sí sale fuera de la jornada', loteEmerg.encolados >= 1, loteEmerg)
  const dEmerg = await uno(`select d.estado, d.es_emergencia, d.mensaje_id, m.emergencia, m.emergencia_por,
      m.texto, m.prioridad, m.iniciado_por, m.plantilla_variables
    from crm_envio_destinos d join crm_mensajes m on m.id = d.mensaje_id
    where d.envio_id = $1`, [eEmerg.id])
  esperar('el destino queda marcado como emergencia', dEmerg.es_emergencia === true)
  esperar('y el mensaje también, con quién lo autorizó',
    dEmerg.emergencia === true && dEmerg.emergencia_por === admin.id)
  esperar('el id del mensaje ES el id del destino (idempotencia)',
    dEmerg.mensaje_id !== null)
  esperar('el texto sale con los marcadores resueltos',
    dEmerg.texto === 'Evacuación en Sede A F10', dEmerg.texto)
  esperar('y las variables de la plantilla, también por persona',
    JSON.stringify(dEmerg.plantilla_variables) === '["Prueba","Evacuación en Sede A F10"]',
    dEmerg.plantilla_variables)
  esperar('lo masivo va con prioridad 7–9 para no tapar al conserje en un punto',
    dEmerg.prioridad >= 7 && dEmerg.prioridad <= 9, dEmerg.prioridad)

  const falloEmerg = await fallo(
    `insert into crm_envios (grupo_id, cuenta_id, nombre, texto, es_emergencia)
     values ($1, $2, 'Emergencia sin autorizar', 'Aviso', true)`, [g.id, cuenta.id])
  esperar('una emergencia sin quién la autorizó ni por qué no se puede guardar',
    (falloEmerg ?? '').includes('ck_crm_envio_emergencia'), falloEmerg)

  // Se devuelve la jornada a una franja que contiene a NOW().
  await jornada(g.id, -1, 1)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('5. El encolado: un whatsapp_encolar por persona, y el portero manda')
  // ═══════════════════════════════════════════════════════════════════════════
  // Sin plantilla y sin ventana de 24 h abierta, el portero OMITE: es lo
  // correcto, y es lo que la consola tiene que avisar antes de mandar.
  const eTexto = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, texto, estado, programado_para)
      values ($1, $2, 'Texto libre sin ventana', 'PERSONAS', ARRAY[$3::uuid],
              'Hola {nombre}', 'CALCULADO', now()) returning id`, [g.id, cuenta.id, p1])
  await c.query(`select public.crm_envio_resolver($1)`, [eTexto.id])
  await c.query(`select public.crm_envio_aprobar($1)`, [eTexto.id])
  const loteTexto = (await uno(`select public.crm_envio_tomar_lote(50) as r`)).r
  const dTexto = await uno(`select estado, omitido_motivo from crm_envio_destinos where envio_id = $1`, [eTexto.id])
  esperar('un texto libre fuera de la ventana de 24 h queda OMITIDO, no se manda',
    dTexto.estado === 'OMITIDO' && (dTexto.omitido_motivo ?? '').includes('24 horas'), dTexto)
  esperar('y el lote lo cuenta como omitido', loteTexto.omitidos >= 1, loteTexto)

  // Con una plantilla PENDIENTE en Meta tampoco sale.
  const ePend = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, texto,
       plantilla_nombre, variables, estado, programado_para)
      values ($1, $2, 'Plantilla sin aprobar', 'PERSONAS', ARRAY[$3::uuid], 'Aviso',
              'aviso_masivo_operacion', '["{nombre}","Prueba"]'::jsonb, 'CALCULADO', now())
      returning id`, [g.id, cuenta.id, p2])
  await c.query(`select public.crm_envio_resolver($1)`, [ePend.id])
  await c.query(`select public.crm_envio_aprobar($1)`, [ePend.id])
  await c.query(`select public.crm_envio_tomar_lote(50)`)
  const dPend = await uno(`select estado, omitido_motivo from crm_envio_destinos where envio_id = $1`, [ePend.id])
  esperar('una plantilla que Meta no aprobó no sale, y lo dice',
    dPend.estado === 'OMITIDO' && (dPend.omitido_motivo ?? '').includes('PENDIENTE'), dPend)

  // Con la plantilla APPROVED sí sale, y las variables se resuelven por persona.
  await c.query(`update whatsapp_plantillas set estado = 'APPROVED', meta_id = 'prueba-f10'
    where nombre = 'aviso_masivo_operacion'`)
  const eApro = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas,
       texto, plantilla_nombre, variables, estado, programado_para, costo_unitario)
      values ($1, $2, 'Aviso aprobado', 'PERSONAS', ARRAY[$3::uuid, $4::uuid],
              'Hola {nombre}. Mañana el ingreso a {sede} es por la puerta 2.',
              'aviso_masivo_operacion',
              '["{nombre}","Mañana el ingreso es por la puerta 2."]'::jsonb,
              'CALCULADO', now(), 30) returning id`, [g.id, cuenta.id, p1, p2])
  await c.query(`select public.crm_envio_resolver($1)`, [eApro.id])
  await c.query(`select public.crm_envio_aprobar($1, null, 15)`, [eApro.id])
  // LA TRAMPA DE F8: dentro de una transacción NOW() es la hora de inicio y no
  // avanza, así que el segundo destino del escalonado (NOW() + 1/15 s) nunca
  // «vence». Se adelantan las horas a mano para poder ver salir a los dos; que
  // el reparto sea correcto ya se comprobó en el punto 3.
  await c.query(`update crm_envio_destinos set programado_para = now() - interval '1 second'
    where envio_id = $1 and estado = 'PENDIENTE'`, [eApro.id])
  const loteApro = (await uno(`select public.crm_envio_tomar_lote(50) as r`)).r
  esperar('con la plantilla aprobada y dentro de jornada, se encolan los dos',
    loteApro.encolados === 2, loteApro)
  const msgs = await todos(`select d.persona_id, d.estado, d.costo, m.id as mid, m.tipo, m.es_plantilla,
        m.plantilla_nombre, m.plantilla_variables, m.texto, m.estado as mestado, m.conversacion_id
      from crm_envio_destinos d join crm_mensajes m on m.id = d.mensaje_id
     where d.envio_id = $1 order by d.persona_id`, [eApro.id])
  esperar('hay UN mensaje por persona, no uno para el grupo', msgs.length === 2, msgs.length)
  esperar('cada mensaje va a su propia conversación',
    new Set(msgs.map((m) => m.conversacion_id)).size === 2)
  esperar('el mensaje es de tipo PLANTILLA', msgs.every((m) => m.tipo === 'PLANTILLA' && m.es_plantilla))
  esperar('nace PENDIENTE en el buzón de salida de F9 (lo envía su cron)',
    msgs.every((m) => m.mestado === 'PENDIENTE'), msgs.map((m) => m.mestado))
  esperar('la primera variable se resolvió con el nombre de cada persona',
    msgs.every((m) => m.plantilla_variables[0] === 'Prueba'), msgs.map((m) => m.plantilla_variables))
  esperar('el destino guarda el costo unitario del envío',
    msgs.every((m) => Number(m.costo) === 30))
  const unoApro = msgs[0]
  esperar('el id del mensaje es el id de su destino',
    (await uno(`select id from crm_envio_destinos where mensaje_id = $1`, [unoApro.mid])).id === unoApro.mid)

  // Pasar el lote dos veces no duplica mensajes.
  await c.query(`update crm_envio_destinos set estado = 'PENDIENTE',
      programado_para = now() - interval '1 second' where envio_id = $1`, [eApro.id])
  const loteOtra = (await uno(`select public.crm_envio_tomar_lote(50) as r`)).r
  const nMsgs = await uno(`select count(*)::int as n from crm_mensajes m
    join crm_envio_destinos d on d.mensaje_id = m.id where d.envio_id = $1`, [eApro.id])
  esperar('reencolar el mismo destino no crea un segundo mensaje', nMsgs.n === 2, nMsgs.n)

  const envioFin = await uno(`select estado, iniciado_at, terminado_at from crm_envios where id = $1`, [eApro.id])
  esperar('el envío avanza a EN_CURSO o COMPLETADO al salir',
    ['EN_CURSO', 'COMPLETADO'].includes(envioFin.estado), envioFin.estado)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('6. El espejo de estado: del mensaje al destino, sin retroceder')
  // ═══════════════════════════════════════════════════════════════════════════
  await c.query(`update crm_mensajes set estado = 'ENVIADO', enviado_at = now(),
     wamid = 'wamid.PRUEBAF10' where id = $1`, [unoApro.mid])
  let d6 = await uno(`select estado, externo_id, enviado_at from crm_envio_destinos where id = $1`, [unoApro.mid])
  esperar('el destino pasa a ENVIADO con su wamid',
    d6.estado === 'ENVIADO' && d6.externo_id === 'wamid.PRUEBAF10', d6)

  await c.query(`select public.whatsapp_estado_entrega('wamid.PRUEBAF10', 'read')`)
  d6 = await uno(`select estado, leido_at from crm_envio_destinos where id = $1`, [unoApro.mid])
  esperar('un `read` de Meta llega hasta el destino', d6.estado === 'LEIDO', d6)

  await c.query(`select public.whatsapp_estado_entrega('wamid.PRUEBAF10', 'sent')`)
  d6 = await uno(`select estado from crm_envio_destinos where id = $1`, [unoApro.mid])
  esperar('un `sent` desordenado NO desmarca un `read`', d6.estado === 'LEIDO', d6.estado)

  // Respuesta de la persona → RESPONDIDO.
  await c.query(`insert into crm_mensajes (conversacion_id, cuenta_id, direccion, tipo, estado, wamid, texto)
    values ($1, $2, 'ENTRANTE', 'TEXTO', 'RECIBIDO', 'wamid.RESPUESTAF10', 'Entendido')`,
    [unoApro.conversacion_id, cuenta.id])
  d6 = await uno(`select estado, respondido_at from crm_envio_destinos where id = $1`, [unoApro.mid])
  esperar('si la persona contesta, el destino queda RESPONDIDO',
    d6.estado === 'RESPONDIDO' && d6.respondido_at !== null, d6)

  const resumen = await uno(`select * from crm_envios_resumen where envio_id = $1`, [eApro.id])
  esperar('la vista de tablero cuenta los estados en SQL',
    Number(resumen.respondidos) === 1 && Number(resumen.total_destinos) === 2, resumen)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('7. Cancelar un envío')
  // ═══════════════════════════════════════════════════════════════════════════
  const eCanc = await uno(`insert into crm_envios
      (grupo_id, cuenta_id, nombre, audiencia_alcance, audiencia_personas, texto,
       plantilla_nombre, estado, programado_para)
      values ($1, $2, 'Para cancelar', 'PERSONAS', ARRAY[$3::uuid], 'Aviso',
              'aviso_masivo_operacion', 'CALCULADO', now() + interval '1 day') returning id`,
    [g.id, cuenta.id, p1])
  await c.query(`select public.crm_envio_resolver($1)`, [eCanc.id])
  await c.query(`select public.crm_envio_aprobar($1, now() + interval '1 day')`, [eCanc.id])
  await c.query(`select public.crm_envio_cancelar($1, 'Ya no aplica')`, [eCanc.id])
  const canc = await uno(`select e.estado, e.cancelacion_motivo,
      (select count(*) from crm_envio_destinos d where d.envio_id = e.id and d.estado = 'CANCELADO') as n
    from crm_envios e where e.id = $1`, [eCanc.id])
  esperar('cancelar deja el envío CANCELADO con su motivo',
    canc.estado === 'CANCELADO' && canc.cancelacion_motivo === 'Ya no aplica', canc)
  esperar('y cancela lo que todavía no había salido', Number(canc.n) === 1, canc.n)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('8. Los marcadores y la próxima ubicación (§4.3, apoyada en F8)')
  // ═══════════════════════════════════════════════════════════════════════════
  const render1 = await uno(`select public.crm_envio_render(
    'Hola {nombre}, sos {cargo} en {sede} del contrato {contrato}.', $1, $2) as t`, [p1, g.id])
  esperar('los marcadores de persona, cargo, sede y contrato se resuelven',
    render1.t === 'Hola Prueba, sos Conserje en Sede A F10 del contrato Contrato de prueba F10.', render1.t)

  const renderSinRuta = await uno(`select public.crm_envio_render(
    'Tu próximo punto es {punto} — {punto_nombre}.', $1, $2) as t`, [p1, g.id])
  esperar('sin ruta de hoy NO se inventa un punto',
    renderSinRuta.t === 'Tu próximo punto es sin ruta — sin ruta asignada hoy.', renderSinRuta.t)

  // Una ruta de F8 con dos paradas: la próxima es la primera pendiente.
  const zona = await uno(`insert into ronda_zonas (grupo_id, sede_id, codigo, nombre, orden)
    values ($1, $2, 'F10Z1', 'Zona F10', 1) returning id`, [g.id, s1.id])
  const punto1 = await uno(`insert into ronda_puntos
      (grupo_id, sede_id, zona_id, codigo, nombre, descripcion, estado, orden)
      values ($1, $2, $3, 'F10PT1', 'Porteria norte', 'Entrando a la izquierda', 'ACTIVO', 1)
      returning id`, [g.id, s1.id, zona.id])
  const punto2 = await uno(`insert into ronda_puntos
      (grupo_id, sede_id, zona_id, codigo, nombre, descripcion, estado, orden)
      values ($1, $2, $3, 'F10PT2', 'Cuarto de bombas', 'Al fondo del sotano', 'ACTIVO', 2)
      returning id`, [g.id, s1.id, zona.id])
  const ruta = await uno(`insert into ronda_rutas
      (grupo_id, sede_id, persona_id, codigo, nombre, fecha, estado, activo)
      values ($1, $2, $3, 'F10R1', 'Ruta de prueba F10',
              (now() at time zone 'America/Bogota')::date, 'EN_CURSO', true)
      returning id`, [g.id, s1.id, p1])
  // Una parada CUMPLIDA exige la hora de llegada (CHECK de F8).
  await c.query(`insert into ronda_ruta_paradas
      (ruta_id, grupo_id, sede_id, punto_id, numero_parada, estado, llegado_at)
    values ($1, $2, $3, $4, 1, 'CUMPLIDA', now() - interval '20 minutes'),
           ($1, $2, $3, $5, 2, 'PENDIENTE', null)`,
    [ruta.id, g.id, s1.id, punto1.id, punto2.id])

  const prox = await uno(`select public.ronda_proxima_parada($1) as p`, [p1])
  esperar('F8 dice que la próxima parada es la primera PENDIENTE',
    prox.p?.estado === 'PARADA' && prox.p?.punto?.codigo === 'F10PT2', prox.p?.punto?.codigo)

  const renderRuta = await uno(`select public.crm_envio_render(
    'Tu próximo punto es {punto} — {punto_nombre}.', $1, $2) as t`, [p1, g.id])
  esperar('el marcador trae la parada que de verdad dice F8',
    renderRuta.t === 'Tu próximo punto es F10PT2 — Cuarto de bombas.', renderRuta.t)

  const vars = await uno(`select public.crm_envio_variables('["{nombre}","{punto}"]'::jsonb, $1, $2) as v`,
    [p1, g.id])
  esperar('las variables de la plantilla se resuelven en orden',
    JSON.stringify(vars.v) === '["Prueba","F10PT2"]', vars.v)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('9. El menú por contrato y rol (§4.2)')
  // ═══════════════════════════════════════════════════════════════════════════
  const menuGen = await todos(`select orden, etiqueta, accion from public.crm_menu_para($1) order by orden`, [p1])
  esperar('sin menú propio, la persona recibe el menú general sembrado',
    menuGen.length === 6 && menuGen[0].accion === 'MIS_PUNTOS', menuGen.map((m) => m.accion))
  esperar('el menú general incluye la próxima ubicación',
    menuGen.some((m) => m.accion === 'PROXIMA_UBICACION'))

  await c.query(`insert into crm_menu_opciones (grupo_id, cargo, orden, etiqueta, accion)
    values ($1, null, 1, 'Novedad del contrato', 'NOVEDAD'),
           ($1, null, 2, 'Mi proximo punto', 'PROXIMA_UBICACION')`, [g.id])
  const menuContrato = await todos(`select etiqueta, accion from public.crm_menu_para($1) order by orden`, [p1])
  esperar('el menú del contrato gana sobre el general, completo y sin mezclar',
    menuContrato.length === 2 && menuContrato[0].etiqueta === 'Novedad del contrato', menuContrato)

  await c.query(`insert into crm_menu_opciones (grupo_id, cargo, orden, etiqueta, accion)
    values ($1, 'conserje', 1, 'Solo para conserjes', 'AYUDA')`, [g.id])
  const menuCargo = await todos(`select etiqueta from public.crm_menu_para($1) order by orden`, [p1])
  esperar('el menú de (contrato + cargo) gana sobre el del contrato',
    menuCargo.length === 1 && menuCargo[0].etiqueta === 'Solo para conserjes', menuCargo)
  const menuOtroCargo = await todos(`select etiqueta from public.crm_menu_para($1) order by orden`, [p2])
  esperar('un cargo distinto sigue viendo el menú del contrato',
    menuOtroCargo.length === 2, menuOtroCargo)

  const cargoGuardado = await uno(`select cargo from crm_menu_opciones
    where grupo_id = $1 and cargo is not null`, [g.id])
  esperar('el cargo se guarda normalizado en mayúsculas', cargoGuardado.cargo === 'CONSERJE', cargoGuardado)

  const falloTope = await fallo(
    `insert into crm_menu_opciones (grupo_id, cargo, orden, etiqueta, accion)
     select $1, 'VIGILANTE', i, 'Opcion ' || i, 'AYUDA' from generate_series(1, 11) i`, [g.id])
  esperar('el menú no admite más de 10 opciones activas (tope de WhatsApp)',
    (falloTope ?? '').includes('10 opciones'), falloTope)

  const falloOrden = await fallo(
    `insert into crm_menu_opciones (grupo_id, cargo, orden, etiqueta, accion)
     values (null, null, 1, 'Choca con el general', 'AYUDA')`)
  esperar('dos opciones «de todos los contratos» no pueden compartir el orden',
    (falloOrden ?? '').includes('ux_crm_menu_orden'), falloOrden)

  const falloTexto = await fallo(
    `insert into crm_menu_opciones (grupo_id, cargo, orden, etiqueta, accion)
     values ($1, 'AUDITOR', 9, 'Sin texto', 'TEXTO')`, [g.id])
  esperar('una opción de texto sin texto no se puede guardar',
    (falloTexto ?? '').includes('ck_crm_menu_texto'), falloTexto)

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('10. Permisos y RLS')
  // ═══════════════════════════════════════════════════════════════════════════
  const claves = await todos(`select nombre, permisos ? 'ver_envios_whatsapp' as ver,
      permisos ? 'gestionar_envios_whatsapp' as gestionar, permisos ? 'gestionar_menu_whatsapp' as menu
    from roles where nombre in ('Administrador','Gerencia','Supervisor de Conserjería','Auditor')
    order by nombre`)
  esperar('Administrador, Gerencia y Supervisor tienen las tres claves',
    claves.filter((x) => x.nombre !== 'Auditor').every((x) => x.ver && x.gestionar && x.menu), claves)
  esperar('el Auditor sólo lee', claves.find((x) => x.nombre === 'Auditor')?.ver === true &&
    claves.find((x) => x.nombre === 'Auditor')?.gestionar === false, claves)

  const pols = await todos(`select tablename, policyname, cmd, qual from pg_policies
    where schemaname = 'public' and tablename in ('crm_envios','crm_envio_destinos','crm_menu_opciones')
    order by tablename, policyname`)
  esperar('las tres tablas tienen policy de lectura y ninguna de escritura',
    pols.length === 3 && pols.every((p) => p.cmd === 'SELECT'), pols.map((p) => `${p.tablename}:${p.cmd}`))
  esperar('las llamadas de permiso van envueltas en (select …) para evaluarse una vez por consulta',
    pols.every((p) => /\(\s*SELECT/i.test(p.qual ?? '')), pols.map((p) => p.qual))

  const rlsOn = await todos(`select relname, relrowsecurity from pg_class
    where relname in ('crm_envios','crm_envio_destinos','crm_menu_opciones')`)
  esperar('la RLS está activa en las tres', rlsOn.every((x) => x.relrowsecurity), rlsOn)

  // Un usuario autenticado SIN el permiso no ve nada, y no puede escribir.
  // `usuarios.id` ES el uid de auth: no hay columna puente.
  const usuarioSin = await uno(`select u.id from usuarios u
    where u.rol::text not in ('ADMIN','SUPER_ADMIN')
      and coalesce(u.permisos ->> 'ver_envios_whatsapp', '') <> 'true'
      and coalesce(u.permisos ->> 'gestionar_envios_whatsapp', '') <> 'true'
      and not coalesce(
        (select (r.permisos ->> 'ver_envios_whatsapp') = 'true' from roles r where r.id = u.rol_id), false)
      and not coalesce(
        (select (r.permisos ->> 'gestionar_envios_whatsapp') = 'true' from roles r where r.id = u.rol_id), false)
    limit 1`)
  if (usuarioSin) {
    await c.query(`select set_config('request.jwt.claims',
      json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`, [usuarioSin.id])
    await c.query(`set local role authenticated`)
    const ve = await uno(`select count(*)::int as n from crm_envios`)
    esperar('sin la clave de permiso no se ve ningún envío', ve.n === 0, ve.n)
    const falloRpc = await fallo(`select public.crm_envio_resolver($1)`, [envio.id])
    esperar('sin la clave de permiso la RPC rechaza', (falloRpc ?? '').includes('permiso'), falloRpc)
    await c.query(`reset role`)
    // Las claims quedan puestas para el resto de la transacción: hay que
    // quitarlas o las comprobaciones siguientes seguirían corriendo como ese
    // usuario sin permiso.
    await c.query(`select set_config('request.jwt.claims', '{}', true)`)
  } else {
    console.log('  --   (no hay un usuario sin el permiso con el que probar la RLS)')
  }

  // ═══════════════════════════════════════════════════════════════════════════
  titulo('11. El contrato manda')
  // ═══════════════════════════════════════════════════════════════════════════
  await c.query(`update grupo_reglas set permite_whatsapp = false where grupo_id = $1`, [gOtro.id])
  const falloPermite = await fallo(
    `select public.crm_envio_crear($1, 'No deberia poder', 'AVISO', 'CONTRATO',
     '{}'::uuid[], '{}'::text[], 'CUALQUIERA', null, '{}'::uuid[], null, '[]'::jsonb, 'Aviso')`, [gOtro.id])
  esperar('un contrato que no habilitó WhatsApp no admite envíos',
    (falloPermite ?? '').includes('no tiene habilitada'), falloPermite)

  // `select (f(...)).*` llamaría a la función una vez POR COLUMNA (38 envíos):
  // se llama con `select * from f(...)`.
  const creado = await uno(`select * from public.crm_envio_crear($1, 'Creado por RPC', 'AVISO', 'CONTRATO',
      '{}'::uuid[], ARRAY['conserje'], 'CUALQUIERA', null, '{}'::uuid[], 'AVISO_MASIVO_OPERACION',
      '[]'::jsonb, 'Hola {nombre}')`, [g.id])
  esperar('la RPC crea el envío en BORRADOR', creado.estado === 'BORRADOR', creado.estado)
  esperar('y normaliza el cargo y el nombre de la plantilla',
    creado.audiencia_cargos[0] === 'CONSERJE' && creado.plantilla_nombre === 'aviso_masivo_operacion', creado)

  console.log(`\n${'═'.repeat(66)}`)
  console.log(`  ${ok} bien · ${mal} mal`)
  console.log('═'.repeat(66))
} finally {
  await c.query('ROLLBACK')
  await c.end()
}
process.exit(mal === 0 ? 0 : 1)

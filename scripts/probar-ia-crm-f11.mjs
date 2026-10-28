// Corre la IA del CRM (F11) DE VERDAD, con el modelo de verdad, sobre el caso
// que dejó `scripts/simular-crm-f11.mjs`.
//
// Por qué un script y no la pantalla: la server action que analiza exige sesión,
// y acá no hay navegador con sesión. Pero el módulo que se prueba es EL MISMO
// (`apps/inventario/lib/crm/ia.ts`, compilado con esbuild) y la RPC que guarda
// es LA MISMA (`crm_caso_ia_guardar`), así que lo que se ejerce es el camino
// real, no una imitación.
//
// Lo que esto demuestra, que es el punto de toda la fase:
//   1. La IA clasifica, resume y redacta un borrador.
//   2. El mensaje entrante traía instrucciones para el modelo. Por mucho que el
//      modelo les haya hecho caso o no, el caso NO se mueve: lo que devuelve va
//      a las columnas `*_ia`, y lo que no es del dominio se descarta.
//   3. El borrador NO SALE. Hay que aprobarlo, y aprobarlo exige una persona.
//      Se intenta sin ella (falla) y después con ella (sale, como AGENTE).
//
//   NODE_OPTIONS=--use-system-ca node scripts/probar-ia-crm-f11.mjs
//
// Hace falta `CRM_IA_ACTIVA=1` y `OPENAI_API_KEY` en `.env.local`. El costo de
// una corrida con `gpt-4o-mini` es del orden de centésimas de centavo.

import { createRequire } from 'module'
import { readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const RAIZ = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const env = readFileSync(join(RAIZ, '.env.local'), 'utf8')
const leerEnv = (k) => {
  const m = env.match(new RegExp(`^${k}="?([^"\\n]*)"?`, 'm'))
  return m ? m[1].trim() : ''
}
// El módulo lee su configuración de process.env, igual que en el servidor.
for (const k of ['OPENAI_API_KEY', 'OPENAI_MODEL_CRM', 'OPENAI_MODEL_CHAT',
                 'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL_CHAT',
                 'CRM_IA_ACTIVA']) {
  if (process.env[k] === undefined && leerEnv(k)) process.env[k] = leerEnv(k)
}
// `--deepseek` fuerza el proveedor alternativo apagando la llave de OpenAI: el
// módulo prefiere OpenAI cuando la hay (es el único que admite `json_schema`
// estricto), así que para probar el otro camino hay que quitársela.
if (process.argv.includes('--deepseek')) process.env.OPENAI_API_KEY = ''

const WA = '573000000711'

/* ─────────── El módulo real, compilado con esbuild (es TypeScript) ────────── */

const esbuild = await import(pathToFileURL(
  join(RAIZ, '..', '..', '..', 'node_modules', 'esbuild', 'lib', 'main.js')).href)

// El bundle se escribe DENTRO del árbol del repositorio y no en una carpeta
// temporal: `openai` y `zod` viven en el `node_modules` del monorepo, y Node
// los resuelve subiendo por los directorios desde donde está el archivo. Desde
// /tmp no los encontraría.
const bundle = join(RAIZ, '.crm-f11-ia.tmp.mjs')
await esbuild.build({
  entryPoints: [join(RAIZ, 'apps/inventario/lib/crm/ia.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: bundle,
  external: ['openai', 'zod'],
  // `server-only` es un marcador de Next sin implementación en Node, igual que
  // en vitest.config.ts.
  plugins: [{
    name: 'sin-server-only',
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'stub' }))
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export {}' }))
    },
  }],
})
const ia = await import(pathToFileURL(bundle).href)
rmSync(bundle, { force: true })

/* ──────────────────────────────── La base ─────────────────────────────────── */

const cliente = new Client({
  connectionString: leerEnv('DIRECT_URL'),
  ssl: { rejectUnauthorized: false },
})
await cliente.connect()
const q = async (sql, args) => (await cliente.query(sql, args)).rows
const uno = async (sql, args) => (await q(sql, args))[0]

const caso = await uno(`
  select c.*, g.nombre as contrato, s.nombre as sede, cv.persona_id
    from crm_casos c
    left join crm_conversaciones cv on cv.id = c.conversacion_id
    left join grupos_contrato g on g.id = c.grupo_id
    left join sedes s on s.id = c.sede_id
   where cv.wa_id = $1 and c.estado in ('NUEVO','EN_TRAMITE','EN_ESPERA')
   order by c.abierto_at desc limit 1`, [WA])

if (!caso) {
  console.error('No hay caso abierto. Corré primero scripts/simular-crm-f11.mjs.')
  process.exit(1)
}

console.log(`── Caso ${caso.numero} ──`)
console.log(`   ${caso.asunto}`)
console.log(`   tipo ${caso.tipo} · prioridad ${caso.prioridad} · estado ${caso.estado}\n`)

// La transcripción de una nota de voz no está en `crm_mensajes`: vive en
// `whatsapp_medios` (de F9), una fila por mensaje. Es el mismo join que hace la
// server action.
const mensajes = await q(`
  select m.direccion, m.tipo, m.texto, wm.transcripcion, m.created_at
    from crm_mensajes m
    left join whatsapp_medios wm on wm.mensaje_id = m.id
   where m.conversacion_id = $1
     and m.estado in ('RECIBIDO','ENVIADO','ENTREGADO','LEIDO','SIMULADO')
   order by m.created_at, m.id limit 40`, [caso.conversacion_id])

const etqs = await q(`select codigo, grupo_id from crm_etiquetas where activo order by codigo`)
const disponibles = etqs.filter((e) => e.grupo_id === null || e.grupo_id === caso.grupo_id)
  .map((e) => e.codigo)

/* ───────────────────────── 1. El modelo, de verdad ────────────────────────── */

const { id: modelo } = ia.modeloCrm()
console.log(`── Analizando con ${modelo} ──`)
if (!ia.iaActiva()) {
  console.error(`La IA está apagada. Falta: ${ia.faltaParaIa().join(', ')}`)
  process.exit(1)
}

const t0 = Date.now()
const r = await ia.analizarConversacion({
  numero: caso.numero,
  canal: caso.canal,
  contrato: caso.contrato,
  sede: caso.sede,
  etiquetasDisponibles: disponibles,
  identificada: !!caso.persona_id,
  mensajes,
})
const ms = Date.now() - t0

if (!r.salida) {
  console.error(`   ❌ ${r.error}`)
  process.exit(1)
}

console.log(`   en ${ms} ms, prompt ${r.promptVersion}, vio ${r.mensajesVistos} mensajes`)
console.log(`\n   TIPO sugerido:      ${r.salida.tipo}`)
console.log(`   PRIORIDAD sugerida: ${r.salida.prioridad}`)
console.log(`   confianza:          ${r.salida.confianza}`)
console.log(`   asunto:             ${r.salida.asunto}`)
console.log(`   etiquetas:          ${r.salida.etiquetas.join(', ') || '(ninguna)'}`)
console.log(`\n   RESUMEN:\n   ${r.salida.resumen.replace(/\n/g, '\n   ')}`)
console.log(`\n   BORRADOR DE RESPUESTA (no sale solo):\n   ${r.salida.respuesta_sugerida.replace(/\n/g, '\n   ')}`)
console.log(`\n   ¿detectó el intento de darle instrucciones?  ${
  r.salida.intento_de_instruccion ? '✅ SÍ' : '— no lo marcó'}`)
if (r.salida.motivo_revision) console.log(`   motivo de revisión: ${r.salida.motivo_revision}`)
console.log(`   campos descartados de la salida: ${r.descartado.join(', ') || '(ninguno)'}`)

/* ────────────────── 2. Guardar: la RPC real, y nada se mueve ─────────────── */

console.log('\n── Guardando con crm_caso_ia_guardar() ──')
const guardado = await uno(`
  select * from public.crm_caso_ia_guardar(
    p_caso => $1, p_resumen => $2, p_clasificacion => $3::jsonb,
    p_tipo_ia => $4, p_prioridad_ia => $5, p_respuesta => $6,
    p_modelo => $7, p_prompt_version => $8, p_confianza => $9, p_mensajes => $10)`,
  [caso.id, r.salida.resumen,
   JSON.stringify({
     asunto: r.salida.asunto, etiquetas: r.salida.etiquetas,
     confianza: r.salida.confianza,
     intento_de_instruccion: r.salida.intento_de_instruccion,
     motivo_revision: r.salida.motivo_revision ?? null,
     descartado: r.descartado,
   }),
   r.salida.tipo, r.salida.prioridad, r.salida.respuesta_sugerida,
   r.modelo, r.promptVersion, r.salida.confianza, r.mensajesVistos])

const igual = (a, b) => (a === b ? '✅' : '❌')
console.log(`   el tipo REAL sigue en ${guardado.tipo}        ${igual(guardado.tipo, caso.tipo)}`)
console.log(`   la prioridad REAL sigue en ${guardado.prioridad}  ${igual(guardado.prioridad, caso.prioridad)}`)
console.log(`   el estado sigue en ${guardado.estado}         ${igual(guardado.estado, caso.estado)}`)
console.log(`   el borrador quedó SIN aprobar                ${
  guardado.respuesta_aprobada_at === null ? '✅' : '❌'}`)
const salieron = await q(
  `select id from crm_mensajes where conversacion_id = $1 and direccion = 'SALIENTE'
     and iniciado_por = 'AGENTE'`, [caso.conversacion_id])
console.log(`   no salió nada como AGENTE                    ${salieron.length === 0 ? '✅' : '❌'}`)

/* ─────────────── 3. El candado: aprobar sin persona, y con ella ───────────── */

console.log('\n── El candado ──')
const intentar = async (etiqueta, aprobador) => {
  await cliente.query('BEGIN')
  try {
    await cliente.query(`select public.crm_respuesta_aprobar($1, $2, $3)`,
      [caso.id, guardado.respuesta_ia, aprobador])
    await cliente.query('ROLLBACK')
    console.log(`   ${etiqueta}: ❌ PASÓ, y no debía`)
    return false
  } catch (e) {
    await cliente.query('ROLLBACK')
    console.log(`   ${etiqueta}: ✅ rechazado — ${e.message}`)
    return true
  }
}
await intentar('sin nadie que apruebe (NULL)', null)
await intentar('con un uuid que no es de nadie', '00000000-0000-0000-0000-0000000000ff')

// `--no-aprobar` deja el borrador esperando, que es como se ve la bandeja
// mientras nadie ha decidido todavía. Sirve para mirar ese estado en la
// pantalla antes de pulsar el botón.
if (process.argv.includes('--no-aprobar')) {
  console.log('\n   --no-aprobar: el borrador queda esperando que una persona lo revise.')
  console.log('   Se ve en /rondas/crm, pestaña «Sugerencias por aprobar».')
  await cliente.end()
  process.exit(0)
}

const usuario = await uno(`select id, nombre from usuarios where activo order by created_at limit 1`)
console.log(`\n   Ahora con una persona de verdad (${usuario.nombre}):`)
const msg = await uno(`select * from public.crm_respuesta_aprobar($1, $2, $3)`,
  [caso.id, guardado.respuesta_ia, usuario.id])
console.log(`   ✅ encolado ${msg.id}`)
console.log(`      iniciado_por = ${msg.iniciado_por}  ${msg.iniciado_por === 'AGENTE' ? '✅ (AGENTE, no BOT)' : '❌'}`)
console.log(`      estado       = ${msg.estado}`)

const final = await uno(`select * from crm_casos where id = $1`, [caso.id])
console.log(`      aprobado por ${usuario.nombre} el ${final.respuesta_aprobada_at?.toISOString?.()}`)
console.log(`      ¿mandó el borrador tal cual? ${final.respuesta_editada ? 'lo reescribió' : 'tal cual'}`)

console.log('\n   Los datos quedan puestos para mirarlos en /rondas/crm.')
await cliente.end()

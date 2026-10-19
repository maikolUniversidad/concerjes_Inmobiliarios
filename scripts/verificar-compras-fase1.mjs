// Indicadores de la fase 1 del módulo de compras (docs/modulo-compras.md §9.7).
//
// La fase 1 existe por una medición concreta: al 2026-10-18 había UNA orden de
// compra en todo el sistema y 768 entradas de mercancía, ninguna con orden
// detrás, con del orden de 350-400 millones al mes entrando a ciegas. Este
// script responde si eso está cambiando.
//
// Solo lee. Uso: node --use-system-ca scripts/verificar-compras-fase1.mjs
import { createRequire } from 'module'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const require = createRequire(import.meta.url)
const { Client } = require('pg')

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const env = readFileSync(join(root, '.env.local'), 'utf8')
const m = env.match(/^DIRECT_URL="?([^"\n]+)"?/m)
if (!m) { console.error('No se encontró DIRECT_URL en .env.local'); process.exit(1) }

const client = new Client({ connectionString: m[1].trim(), ssl: { rejectUnauthorized: false } })
await client.connect()

const pesos = (n) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0,
}).format(Number(n || 0))

const pct = (n) => (n == null ? '—' : `${Number(n).toFixed(1)}%`)

console.log('\n═══ Fase 1 del módulo de compras · indicadores ═══\n')

// ── 1. ¿Las entradas de compra traen su orden? ──────────────────────────────
// Es LA pregunta de la fase. La meta es más del 80% de las entradas nuevas.
const { rows: cobertura } = await client.query(`SELECT * FROM v_compras_cobertura_oc LIMIT 6`)
console.log('1) Entradas al inventario por mes')
console.log('   mes       entradas  se declaran compra  traen orden   % de las compras')
for (const r of cobertura) {
  console.log(
    `   ${r.mes}   ${String(r.entradas).padStart(8)}  ${String(r.marcadas_compra).padStart(18)}  ` +
    `${String(r.con_orden).padStart(11)}   ${pct(r.pct_compras_con_orden).padStart(16)}`,
  )
}

// ── 2. Entradas que nadie clasificó ────────────────────────────────────────
// Mientras la UI solo avisa, esto mide cuánta gente está haciendo el esfuerzo.
const { rows: [sinOrigen] } = await client.query(`
  SELECT COUNT(*) FILTER (WHERE origen IS NULL)                                   AS sin_origen,
         COUNT(*)                                                                  AS total,
         COUNT(*) FILTER (WHERE origen IS NULL AND created_at > NOW() - INTERVAL '30 days') AS sin_origen_30d
    FROM movimientos WHERE tipo = 'ENTRADA'
`)
console.log(`\n2) Entradas sin decir de dónde vienen: ${sinOrigen.sin_origen} de ${sinOrigen.total}`)
console.log(`   (en los últimos 30 días: ${sinOrigen.sin_origen_30d})`)

// ── 3. Separación de funciones ─────────────────────────────────────────────
// La regla la aplica un trigger, así que esto debería dar siempre 0. Si no da
// 0, hay órdenes aprobadas ANTES de la fase 1.
const { rows: [separacion] } = await client.query(`
  SELECT COUNT(*)                                                      AS aprobadas,
         COUNT(*) FILTER (WHERE aprobado_por = creado_por)             AS autoaprobadas,
         COUNT(*) FILTER (WHERE aprobado_por IS NULL)                  AS sin_aprobador
    FROM ordenes_compra WHERE fecha_aprobacion IS NOT NULL
`)
console.log(`\n3) Órdenes aprobadas: ${separacion.aprobadas}`)
console.log(`   aprobadas por quien las creó: ${separacion.autoaprobadas}  (debe ser 0 desde la fase 1)`)
console.log(`   sin aprobador registrado:     ${separacion.sin_aprobador}`)

// ── 4. Entregas con fecha y remisión propias ───────────────────────────────
const { rows: [entregas] } = await client.query(`
  SELECT COUNT(*)                                                 AS entregas,
         COUNT(*) FILTER (WHERE remision IS NOT NULL)             AS con_remision,
         COUNT(*) FILTER (WHERE ubicacion_id IS NOT NULL)         AS con_ubicacion,
         COUNT(DISTINCT oc_id)                                     AS ordenes
    FROM oc_recepciones
`)
const { rows: [rechazos] } = await client.query(`
  SELECT COALESCE(SUM(cantidad), 0)::NUMERIC           AS recibido,
         COALESCE(SUM(cantidad_rechazada), 0)::NUMERIC AS rechazado
    FROM oc_recepcion_items
`)
console.log(`\n4) Entregas registradas: ${entregas.entregas} en ${entregas.ordenes} órdenes`)
console.log(`   con remisión del proveedor: ${entregas.con_remision}`)
console.log(`   con ubicación en bodega:    ${entregas.con_ubicacion}`)
console.log(`   unidades recibidas ${rechazos.recibido} · rechazadas ${rechazos.rechazado}`)

// ── 5. Topes de aprobación: ¿siguen apagados? ──────────────────────────────
// Nacen apagados porque el rol Gerencia no tenía usuarios. Esto lo recuerda.
const { rows: niveles } = await client.query(`
  SELECT monto_desde, monto_hasta, permiso, activo FROM compras_niveles_aprobacion ORDER BY monto_desde
`)
console.log('\n5) Topes de aprobación')
for (const n of niveles) {
  const rango = n.monto_hasta
    ? `${pesos(n.monto_desde)} a ${pesos(n.monto_hasta)}`
    : `más de ${pesos(n.monto_desde)}`
  console.log(`   ${rango} → ${n.permiso}${n.activo ? '' : ' (inactivo)'}`)
}

const { rows: gerencia } = await client.query(`
  SELECT r.nombre, COUNT(u.id) AS cuentas
    FROM roles r LEFT JOIN usuarios u ON u.rol_id = r.id
   WHERE (r.permisos ->> 'aprobar_ordenes_compra_sin_tope') = 'true'
   GROUP BY r.nombre ORDER BY r.nombre
`)
const conGente = gerencia.filter((g) => Number(g.cuentas) > 0)
if (conGente.length === 0) {
  console.log('\n   ⚠  Ningún usuario tiene "aprobar_ordenes_compra_sin_tope".')
  console.log('      Por eso el nivel alto sigue apuntando al permiso del nivel bajo.')
  console.log('      Cuando alguien tome el rol Gerencia, encender el tope es una fila:')
  console.log("        UPDATE compras_niveles_aprobacion")
  console.log("           SET permiso = 'aprobar_ordenes_compra_sin_tope'")
  console.log('         WHERE monto_hasta IS NULL;')
} else {
  console.log(`\n   Pueden aprobar sin tope: ${conGente.map((g) => `${g.nombre} (${g.cuentas})`).join(', ')}`)
  const alto = niveles.find((n) => !n.monto_hasta)
  if (alto && alto.permiso !== 'aprobar_ordenes_compra_sin_tope') {
    console.log('   ⚠  Ya hay quién apruebe sin tope, pero el nivel alto sigue apagado.')
    console.log('      Vale encenderlo (ver el UPDATE en el comentario de la migración).')
  }
}

console.log('')
await client.end()

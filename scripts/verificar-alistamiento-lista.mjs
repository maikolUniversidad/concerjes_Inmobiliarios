/**
 * Compara, orden por orden, los contadores que la pantalla /alistamiento
 * calculaba en TypeScript contra los que ahora devuelve v_alistamiento_lista.
 *
 * La lógica "vieja" de aquí abajo es copia literal de AlistamientoClient.tsx
 * antes del cambio (sinStock, pendienteEnvio, unidades/flujoItem, cuenta) y de
 * page.tsx (responsables por lotes ordenados por usuario_id).
 *
 *   node --env-file=.env.local scripts/verificar-alistamiento-lista.mjs
 */
import pg from 'pg'

const ESTADOS_ALISTAMIENTO = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO']
const ESTADOS_YA_SALIO = ['DESPACHADO', 'EN_RUTA', 'ENTREGADO', 'RECIBIDO']
const yaSalio = (estado) => ESTADOS_YA_SALIO.includes(estado)

// ── Lógica vieja, tal cual estaba en el cliente ─────────────────────────────
const sinStock = (o) => o.estado === 'DESPACHADO' ? 0 : (o.items ?? []).filter((i) =>
  !i.alistado && Number(i.cantidad_solicitada) > Number(i.producto?.stock?.cantidad_real ?? 0)).length

const pendienteEnvio = (o) => {
  let unidades = 0; let items = 0
  for (const i of o.items ?? []) {
    const p = Math.max(0, Number(i.cantidad_solicitada) - Number(i.cantidad_alistada))
    if (p > 0) { unidades += p; items++ }
  }
  return { unidades, items }
}

const flujoItem = (it) => {
  const pedido = Number(it.solicitado) || 0
  const alist = Number(it.cantidadAlistada) || 0
  if (yaSalio(it.estado)) return { pedido, alistado: alist, despachado: alist }
  return { pedido, alistado: it.alistado ? alist : 0, despachado: 0 }
}

const unidades = (o) => {
  let pedido = 0; let alistado = 0; let despachado = 0
  for (const i of o.items ?? []) {
    const f = flujoItem({ estado: o.estado, solicitado: Number(i.cantidad_solicitada), cantidadAlistada: Number(i.cantidad_alistada), alistado: i.alistado })
    pedido += f.pedido; alistado += f.alistado; despachado += f.despachado
  }
  return { pedido, alistado, despachado }
}

const cuenta = (o) => {
  const total = o.items?.length ?? 0
  const listos = (o.items ?? []).filter((i) => i.alistado).length
  return { total, listos }
}

// ── Datos ───────────────────────────────────────────────────────────────────
const client = new pg.Client({ connectionString: process.env.DIRECT_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

// Lo mismo que traía el select anidado de PostgREST.
const { rows: ordenes } = await client.query(
  `SELECT o.id, o.numero, o.estado, s.nombre AS sede
     FROM ordenes_insumo o
     LEFT JOIN sedes s ON s.id = o.sede_id
    WHERE o.estado = ANY($1)`,
  [ESTADOS_ALISTAMIENTO],
)
const { rows: items } = await client.query(
  `SELECT i.orden_id, i.alistado, i.cantidad_solicitada, i.cantidad_alistada,
          st.cantidad_real
     FROM orden_insumo_items i
     LEFT JOIN stock st ON st.producto_id = i.producto_id
     JOIN ordenes_insumo o ON o.id = i.orden_id
    WHERE o.estado = ANY($1)`,
  [ESTADOS_ALISTAMIENTO],
)
// Responsables como los armaba la página: lotes ordenados por (orden_id, usuario_id).
const { rows: resp } = await client.query(
  `SELECT r.orden_id, r.nombre
     FROM responsables_opciones r
     JOIN ordenes_insumo o ON o.id = r.orden_id
    WHERE o.estado = ANY($1)
    ORDER BY r.orden_id, r.usuario_id`,
  [ESTADOS_ALISTAMIENTO],
)

const porOrden = new Map(ordenes.map((o) => [o.id, { ...o, items: [] }]))
for (const i of items) {
  porOrden.get(i.orden_id).items.push({
    alistado: i.alistado,
    cantidad_solicitada: i.cantidad_solicitada,
    cantidad_alistada: i.cantidad_alistada,
    producto: { stock: i.cantidad_real === null ? null : { cantidad_real: i.cantidad_real } },
  })
}
const responsables = {}
for (const r of resp) (responsables[r.orden_id] ??= []).push(r.nombre)

// ── La vista ────────────────────────────────────────────────────────────────
const { rows: vista } = await client.query(
  `SELECT id, numero, estado, sede, total_items, alistados, sin_stock,
          pend_items, pend_unidades, und_pedido, und_alistado, und_despachado,
          responsables
     FROM v_alistamiento_lista
    WHERE estado = ANY($1)`,
  [ESTADOS_ALISTAMIENTO],
)
const porVista = new Map(vista.map((v) => [v.id, v]))

// ── Comparación campo por campo ─────────────────────────────────────────────
const dif = []
let comparadas = 0

for (const o of porOrden.values()) {
  const v = porVista.get(o.id)
  if (!v) { dif.push(`${o.numero}: la vista no devuelve esta orden`); continue }

  const c = cuenta(o)
  const pe = pendienteEnvio(o)
  const u = unidades(o)
  const esperado = {
    estado: o.estado,
    sede: o.sede ?? null,
    total_items: c.total,
    alistados: c.listos,
    sin_stock: sinStock(o),
    pend_items: pe.items,
    pend_unidades: pe.unidades,
    und_pedido: u.pedido,
    und_alistado: u.alistado,
    und_despachado: u.despachado,
    responsables: responsables[o.id] ?? [],
  }

  for (const [campo, val] of Object.entries(esperado)) {
    const dado = v[campo]
    const igual = Array.isArray(val)
      ? JSON.stringify(val) === JSON.stringify(dado ?? [])
      : typeof val === 'number'
        ? Number(dado) === val
        : (dado ?? null) === (val ?? null)
    if (!igual) dif.push(`${o.numero} · ${campo}: viejo=${JSON.stringify(val)} vista=${JSON.stringify(dado)}`)
  }
  comparadas++
}

// Y al revés: que la vista no se invente órdenes.
for (const v of vista) if (!porOrden.has(v.id)) dif.push(`${v.numero}: la vista devuelve una orden que la lógica vieja no tenía`)

console.log(`Órdenes comparadas: ${comparadas} (vista: ${vista.length}) · ítems: ${items.length}`)
if (dif.length === 0) {
  console.log('✅ IDÉNTICO en los 11 campos de todas las órdenes')
} else {
  console.log(`❌ ${dif.length} diferencias:`)
  for (const d of dif.slice(0, 50)) console.log('  ' + d)
}

// ── Tiempos ─────────────────────────────────────────────────────────────────
const cronometrar = async (etiqueta, sql) => {
  const t = []
  for (let k = 0; k < 5; k++) { const a = Date.now(); await client.query(sql, [ESTADOS_ALISTAMIENTO]); t.push(Date.now() - a) }
  console.log(`${etiqueta}: ${Math.min(...t)}–${Math.max(...t)} ms`)
}
await cronometrar('vista nueva ', `SELECT * FROM v_alistamiento_lista WHERE estado = ANY($1)`)
await cronometrar('select viejo', `SELECT o.id, (SELECT json_agg(x) FROM (
    SELECT i.alistado, i.cantidad_solicitada, i.cantidad_alistada,
           (SELECT json_build_object('stock', json_build_object('cantidad_real', st.cantidad_real, 'cantidad_disp', st.cantidad_disp))
              FROM stock st WHERE st.producto_id = i.producto_id) AS producto
      FROM orden_insumo_items i WHERE i.orden_id = o.id) x) AS items
  FROM ordenes_insumo o WHERE o.estado = ANY($1)`)

await client.end()
process.exit(dif.length === 0 ? 0 : 1)

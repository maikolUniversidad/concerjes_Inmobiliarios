'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from '@/lib/supabase/server'

async function db() {
  return (await createClient()) as any
}

async function uid(): Promise<string | null> {
  const s = await db()
  const { data } = await s.auth.getUser()
  return data?.user?.id ?? null
}

// ── Parametrización ──────────────────────────────────────────────────────────

export async function getParametrosPago() {
  const s = await db()
  const { data, error } = await s
    .from('parametros_pago_hogar')
    .select('*')
    .eq('codigo', 'DEFAULT')
    .maybeSingle()
  if (error) throw error
  return data
}

export async function guardarParametrosPago(payload: any) {
  const s = await db()
  const { id, codigo, consecutivo, created_at, updated_at, ...rest } = payload
  const { error } = await s
    .from('parametros_pago_hogar')
    .update(rest)
    .eq('codigo', 'DEFAULT')
  if (error) throw error
}

export async function getMetodosPago() {
  const s = await db()
  const { data, error } = await s
    .from('metodos_pago_hogar')
    .select('*')
    .order('orden')
  if (error) throw error
  return data ?? []
}

export async function upsertMetodoPago(metodo: any) {
  const s = await db()
  const { id, created_at, updated_at, ...rest } = metodo
  if (!rest.codigo?.trim() || !rest.nombre?.trim()) throw new Error('El código y el nombre son obligatorios.')
  rest.codigo = String(rest.codigo).trim().toUpperCase()

  if (id) {
    const { error } = await s.from('metodos_pago_hogar').update(rest).eq('id', id)
    if (error) throw error
  } else {
    const { error } = await s.from('metodos_pago_hogar').insert(rest)
    if (error) throw error
  }
}

export async function eliminarMetodoPago(id: string) {
  const s = await db()
  const { error } = await s.from('metodos_pago_hogar').delete().eq('id', id)
  if (error) throw error
}

// ── Cobros ───────────────────────────────────────────────────────────────────

export async function getResumenPagos() {
  const s = await db()
  const hoy = new Date().toISOString().split('T')[0]

  const [porCobrar, vencidos, porVerificar, cobrosPagados] = await Promise.all([
    s.from('cobros_servicio_hogar').select('saldo').in('estado', ['EMITIDO', 'PARCIAL']),
    s.from('cobros_servicio_hogar').select('id', { count: 'exact', head: true })
      .in('estado', ['EMITIDO', 'PARCIAL']).lt('fecha_vencimiento', hoy),
    s.from('pagos_hogar').select('id', { count: 'exact', head: true }).eq('estado', 'REPORTADO'),
    s.from('cobros_servicio_hogar').select('total').eq('estado', 'PAGADO'),
  ])

  const saldo = ((porCobrar.data ?? []) as { saldo: number }[])
    .reduce((a, c) => a + Number(c.saldo ?? 0), 0)
  const recaudado = ((cobrosPagados.data ?? []) as { total: number }[])
    .reduce((a, c) => a + Number(c.total ?? 0), 0)

  return {
    porCobrar: porCobrar.data?.length ?? 0,
    saldoPendiente: saldo,
    vencidos: vencidos.count ?? 0,
    porVerificar: porVerificar.count ?? 0,
    recaudado,
  }
}

export async function getCobros(params?: { estado?: string; search?: string; page?: number }) {
  const s = await db()
  const limit = 20
  const offset = ((params?.page ?? 1) - 1) * limit

  let q = s
    .from('cobros_servicio_hogar')
    .select('*, solicitudes_servicio_hogar(numero, tipos_servicio_hogar(nombre, icono)), pagos_hogar(id, monto, estado, metodo_nombre, referencia, comprobante_path, created_at, motivo_rechazo)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (params?.estado && params.estado !== 'TODOS') q = q.eq('estado', params.estado)
  if (params?.search) {
    q = q.or(`numero.ilike.%${params.search}%,cliente_nombre.ilike.%${params.search}%,cliente_email.ilike.%${params.search}%`)
  }

  const { data, error, count } = await q
  if (error) throw error
  return { cobros: data ?? [], total: count ?? 0 }
}

/** Solicitudes que ya se pueden cobrar y todavía no tienen cuenta de cobro. */
export async function getSolicitudesSinCobro() {
  const s = await db()
  const { data: sols, error } = await s
    .from('solicitudes_servicio_hogar')
    .select(`id, numero, cliente_id, cliente_nombre, cliente_email, estado, fecha_deseada,
             precio_cotizado, frecuencia,
             tipos_servicio_hogar(nombre, icono), tarifas_servicio_hogar(nombre, precio_unico)`)
    .in('estado', ['CONFIRMADA', 'EN_SERVICIO', 'COMPLETADA'])
    .not('cliente_id', 'is', null)
    .order('fecha_deseada', { ascending: false })
    .limit(100)
  if (error) throw error

  const ids = (sols ?? []).map((x: any) => x.id)
  if (ids.length === 0) return []

  const { data: cobros } = await s
    .from('cobros_servicio_hogar')
    .select('solicitud_id')
    .in('solicitud_id', ids)
    .neq('estado', 'ANULADO')

  const conCobro = new Set((cobros ?? []).map((c: any) => c.solicitud_id))
  return (sols ?? []).filter((x: any) => !conCobro.has(x.id))
}

export interface ItemCobro { descripcion: string; cantidad: number; valor_unitario: number }

/**
 * Crea la cuenta de cobro. Los totales se calculan aquí a partir de los ítems y
 * de la parametrización (IVA), no en el navegador.
 */
export async function crearCobro(payload: {
  solicitud_id?: string | null
  cliente_id?: string | null
  cliente_nombre?: string | null
  cliente_email?: string | null
  concepto: string
  tipo?: string
  items: ItemCobro[]
  descuento?: number
  fecha_vencimiento?: string | null
  link_pago?: string | null
  metodo_sugerido?: string | null
  notas?: string | null
  emitir?: boolean
}) {
  const s = await db()
  const items = (payload.items ?? []).filter((i) => i.descripcion?.trim() && Number(i.valor_unitario) > 0)
  if (items.length === 0) throw new Error('Agrega al menos un ítem con valor.')

  const param = await getParametrosPago()
  const subtotal = items.reduce((a, i) => a + Number(i.cantidad || 1) * Number(i.valor_unitario), 0)
  const descuento = Number(payload.descuento ?? 0)
  const base = Math.max(subtotal - descuento, 0)

  const ivaPct = Number(param?.iva_porcentaje ?? 0)
  // Si los precios ya incluyen IVA, el impuesto va discriminado dentro del total.
  const ivaValor = param?.precios_incluyen_iva
    ? Math.round((base * ivaPct) / (100 + ivaPct))
    : Math.round((base * ivaPct) / 100)
  const total = param?.precios_incluyen_iva ? base : base + ivaValor

  let vencimiento = payload.fecha_vencimiento ?? null
  if (!vencimiento) {
    const d = new Date()
    d.setDate(d.getDate() + Number(param?.dias_vencimiento ?? 3))
    vencimiento = d.toISOString().split('T')[0]
  }

  const { data: numero, error: eNum } = await s.rpc('siguiente_numero_cobro')
  if (eNum) throw eNum

  const { data: cobro, error } = await s
    .from('cobros_servicio_hogar')
    .insert({
      numero,
      solicitud_id:   payload.solicitud_id ?? null,
      cliente_id:     payload.cliente_id ?? null,
      cliente_nombre: payload.cliente_nombre ?? null,
      cliente_email:  payload.cliente_email ?? null,
      concepto:       payload.concepto,
      tipo:           payload.tipo ?? 'TOTAL',
      subtotal,
      descuento,
      iva_porcentaje: ivaPct,
      iva_valor:      ivaValor,
      total,
      saldo:          total,
      moneda:         param?.moneda ?? 'COP',
      estado:         payload.emitir === false ? 'BORRADOR' : 'EMITIDO',
      fecha_emision:  payload.emitir === false ? null : new Date().toISOString().split('T')[0],
      fecha_vencimiento: vencimiento,
      link_pago:      payload.link_pago ?? null,
      metodo_sugerido: payload.metodo_sugerido ?? null,
      notas:          payload.notas ?? null,
      creado_por:     await uid(),
    })
    .select('id, numero')
    .single()
  if (error) throw error

  const { error: eItems } = await s.from('cobro_items_hogar').insert(
    items.map((i, idx) => ({
      cobro_id: cobro.id,
      descripcion: i.descripcion.trim(),
      cantidad: Number(i.cantidad || 1),
      valor_unitario: Number(i.valor_unitario),
      orden: idx,
    }))
  )
  if (eItems) throw eItems

  return cobro
}

export async function emitirCobro(id: string) {
  const s = await db()
  const { error } = await s
    .from('cobros_servicio_hogar')
    .update({ estado: 'EMITIDO', fecha_emision: new Date().toISOString().split('T')[0] })
    .eq('id', id)
    .eq('estado', 'BORRADOR')
  if (error) throw error
}

export async function anularCobro(id: string, motivo: string) {
  const s = await db()
  const { error } = await s
    .from('cobros_servicio_hogar')
    .update({ estado: 'ANULADO', motivo_anulacion: motivo || 'Anulado por el personal' })
    .eq('id', id)
  if (error) throw error
}

export async function actualizarLinkPago(id: string, link: string) {
  const s = await db()
  const { error } = await s
    .from('cobros_servicio_hogar')
    .update({ link_pago: link || null })
    .eq('id', id)
  if (error) throw error
}

// ── Pagos ────────────────────────────────────────────────────────────────────

export async function getPagosPorVerificar() {
  const s = await db()
  const { data, error } = await s
    .from('pagos_hogar')
    .select('*, cobros_servicio_hogar(numero, cliente_nombre, total, saldo)')
    .eq('estado', 'REPORTADO')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

/** Registra un pago recibido por el personal (efectivo, consignación, etc.). */
export async function registrarPagoManual(payload: {
  cobro_id: string
  metodo_id?: string | null
  metodo_nombre?: string | null
  monto: number
  referencia?: string | null
  fecha_pago?: string | null
  notas?: string | null
}) {
  const s = await db()
  const monto = Number(payload.monto)
  if (!monto || monto <= 0) throw new Error('El valor del pago debe ser mayor a cero.')

  const { data: cobro } = await s
    .from('cobros_servicio_hogar')
    .select('id, saldo, estado, cliente_id')
    .eq('id', payload.cobro_id)
    .maybeSingle()
  if (!cobro) throw new Error('Cuenta de cobro no encontrada.')
  if (cobro.estado === 'ANULADO') throw new Error('La cuenta de cobro está anulada.')
  if (cobro.estado === 'BORRADOR') throw new Error('Emite la cuenta de cobro antes de registrar pagos.')
  if (monto > Number(cobro.saldo)) throw new Error('El valor supera el saldo pendiente.')

  const { error } = await s.from('pagos_hogar').insert({
    cobro_id:      payload.cobro_id,
    cliente_id:    cobro.cliente_id,
    metodo_id:     payload.metodo_id ?? null,
    metodo_nombre: payload.metodo_nombre ?? 'Registrado por el personal',
    monto,
    referencia:    payload.referencia ?? null,
    fecha_pago:    payload.fecha_pago ?? new Date().toISOString().split('T')[0],
    origen:        'STAFF',
    estado:        'VERIFICADO',
    notas:         payload.notas ?? null,
    verificado_por: await uid(),
    verificado_at:  new Date().toISOString(),
  })
  if (error) throw error
}

export async function verificarPago(id: string) {
  const s = await db()
  const { data: pago } = await s
    .from('pagos_hogar')
    .select('id, monto, estado, cobro_id, cobros_servicio_hogar(saldo, estado)')
    .eq('id', id)
    .maybeSingle()
  if (!pago) throw new Error('Pago no encontrado.')
  if (pago.estado !== 'REPORTADO') throw new Error('Este pago ya fue procesado.')
  if (Number(pago.monto) > Number(pago.cobros_servicio_hogar?.saldo ?? 0)) {
    throw new Error('El valor del pago supera el saldo actual de la cuenta.')
  }

  const { error } = await s
    .from('pagos_hogar')
    .update({ estado: 'VERIFICADO', verificado_por: await uid(), verificado_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function rechazarPago(id: string, motivo: string) {
  const s = await db()
  const { error } = await s
    .from('pagos_hogar')
    .update({
      estado: 'RECHAZADO',
      motivo_rechazo: motivo || 'El soporte no pudo ser verificado.',
      verificado_por: await uid(),
      verificado_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('estado', 'REPORTADO')
  if (error) throw error
}

/** Enlace temporal para ver el comprobante (el bucket es privado). */
export async function urlComprobante(path: string): Promise<string | null> {
  const s = await db()
  const { data } = await s.storage.from('comprobantes-pago').createSignedUrl(path, 300)
  return data?.signedUrl ?? null
}

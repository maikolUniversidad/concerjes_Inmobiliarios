'use server'
/* eslint-disable @typescript-eslint/no-explicit-any */
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'

/**
 * Programa de puntos y recompensas, desde el administrativo.
 *
 * Los puntos NUNCA se mueven con un UPDATE: siempre por las funciones de la
 * base (`otorgar_puntos`, `redimir_recompensa`, `anular_redencion`), que toman
 * un lock del cliente y dejan el movimiento en el libro. Así el saldo y el
 * histórico no pueden quedar desalineados.
 */

async function db() {
  return (await createClient()) as any
}

async function uid(): Promise<string | null> {
  const s = await db()
  const { data } = await s.auth.getUser()
  return data?.user?.id ?? null
}

// ── Parámetros ───────────────────────────────────────────────────────────────

export async function getParametrosPuntos() {
  const s = await db()
  const { data, error } = await s
    .from('parametros_puntos').select('*').eq('codigo', 'DEFAULT').maybeSingle()
  if (error) throw error
  return data
}

export async function guardarParametrosPuntos(payload: any) {
  const falta = await faltaPermiso('parametrizar_puntos_hogar')
  if (falta) throw new Error(falta)

  const { codigo, updated_at, ...rest } = payload
  // Números negativos en las reglas darían puntos negativos al completar un
  // servicio: se acotan aquí, no en el formulario.
  for (const k of ['puntos_por_mil', 'puntos_por_servicio', 'puntos_por_resena',
                   'puntos_por_referido', 'puntos_bienvenida', 'minimo_redencion', 'valor_punto']) {
    if (rest[k] !== undefined && rest[k] !== null) rest[k] = Math.max(0, Number(rest[k]) || 0)
  }
  if (rest.vigencia_meses !== null && rest.vigencia_meses !== undefined && rest.vigencia_meses !== '') {
    rest.vigencia_meses = Math.max(1, Number(rest.vigencia_meses) || 1)
  } else {
    rest.vigencia_meses = null
  }

  const s = await db()
  const { error } = await s.from('parametros_puntos').update(rest).eq('codigo', 'DEFAULT')
  if (error) throw error
  revalidatePath('/servicios-hogar/puntos')
}

// ── Recompensas ──────────────────────────────────────────────────────────────

export async function getRecompensas() {
  const s = await db()
  const { data, error } = await s.from('recompensas').select('*').order('orden')
  if (error) throw error
  return data ?? []
}

export async function upsertRecompensa(r: any) {
  const falta = await faltaPermiso('gestionar_recompensas')
  if (falta) throw new Error(falta)

  const { id, created_at, updated_at, entregadas, ...rest } = r
  if (!rest.codigo?.trim() || !rest.nombre?.trim()) {
    throw new Error('El código y el nombre son obligatorios.')
  }
  if (!(Number(rest.costo_puntos) > 0)) {
    throw new Error('El costo en puntos debe ser mayor que cero.')
  }
  rest.codigo = String(rest.codigo).trim().toUpperCase()
  rest.costo_puntos = Math.round(Number(rest.costo_puntos))
  rest.valor = Math.max(0, Number(rest.valor) || 0)
  // Vacío = sin límite de unidades; 0 sí significa agotada.
  rest.stock = rest.stock === '' || rest.stock === null || rest.stock === undefined
    ? null : Math.max(0, Math.round(Number(rest.stock)))
  rest.plan_minimo = rest.plan_minimo || null

  const s = await db()
  const { error } = id
    ? await s.from('recompensas').update(rest).eq('id', id)
    : await s.from('recompensas').insert(rest)
  if (error) throw error
  revalidatePath('/servicios-hogar/puntos')
}

export async function archivarRecompensa(id: string, activo: boolean) {
  const falta = await faltaPermiso('gestionar_recompensas')
  if (falta) throw new Error(falta)

  const s = await db()
  // No se borra: las redenciones ya hechas la referencian.
  const { error } = await s.from('recompensas').update({ activo }).eq('id', id)
  if (error) throw error
  revalidatePath('/servicios-hogar/puntos')
}

// ── Redenciones ──────────────────────────────────────────────────────────────

export async function getRedenciones(estado?: string) {
  const s = await db()
  let q = s.from('redenciones')
    .select('*, clientes:cliente_id(nombre, email, telefono)')
    .order('created_at', { ascending: false })
    .limit(200)
  if (estado) q = q.eq('estado', estado)
  const { data, error } = await q
  if (error) throw error
  return data ?? []
}

export async function marcarRedencion(id: string, estado: 'APROBADA' | 'ENTREGADA', notas?: string) {
  const falta = await faltaPermiso('gestionar_puntos_hogar')
  if (falta) throw new Error(falta)

  const s = await db()
  const { error } = await s.from('redenciones').update({
    estado,
    notas: notas || null,
    gestionado_por: await uid(),
    gestionado_at: new Date().toISOString(),
  }).eq('id', id)
  if (error) throw error
  revalidatePath('/servicios-hogar/puntos')
}

export async function anularRedencion(id: string, motivo: string) {
  const falta = await faltaPermiso('gestionar_puntos_hogar')
  if (falta) throw new Error(falta)
  if (!motivo?.trim()) throw new Error('Escribe por qué se anula.')

  const s = await db()
  // La función devuelve los puntos, invalida el cupón y repone el stock.
  const { error } = await s.rpc('anular_redencion', {
    p_redencion: id, p_motivo: motivo.trim(), p_usuario: await uid(),
  })
  if (error) throw error
  revalidatePath('/servicios-hogar/puntos')
}

// ── Ajuste manual de puntos ──────────────────────────────────────────────────

export async function ajustarPuntos(clienteId: string, puntos: number, descripcion: string) {
  const falta = await faltaPermiso('gestionar_puntos_hogar')
  if (falta) throw new Error(falta)
  if (!clienteId) throw new Error('Falta el cliente.')
  const n = Math.round(Number(puntos))
  if (!n) throw new Error('Los puntos deben ser distintos de cero.')
  if (!descripcion?.trim()) throw new Error('Escribe el motivo del ajuste.')

  const s = await db()
  const { error } = await s.rpc('otorgar_puntos', {
    p_cliente: clienteId,
    p_puntos: n,
    p_origen: 'MANUAL',
    p_descripcion: descripcion.trim().slice(0, 200),
    p_solicitud: null,
    p_creado_por: await uid(),
  })
  if (error) throw error
  revalidatePath('/servicios-hogar/puntos')
}

export async function buscarClientes(texto: string) {
  const s = await db()
  const q = (texto ?? '').trim()
  if (q.length < 2) return []
  const { data, error } = await s
    .from('clientes')
    .select('id, nombre, email, puntos')
    .or(`nombre.ilike.%${q}%,email.ilike.%${q}%`)
    .order('nombre')
    .limit(15)
  if (error) throw error
  return data ?? []
}

// ── Resumen para el tablero ──────────────────────────────────────────────────

export async function getResumenPuntos() {
  const s = await db()
  const [pendientes, entregadas, saldo] = await Promise.all([
    s.from('redenciones').select('id', { count: 'exact', head: true }).eq('estado', 'SOLICITADA'),
    s.from('redenciones').select('id', { count: 'exact', head: true }).eq('estado', 'ENTREGADA'),
    s.from('clientes').select('puntos'),
  ])
  const filas = (saldo.data as { puntos: number }[]) ?? []
  return {
    porEntregar: pendientes.count ?? 0,
    entregadas: entregadas.count ?? 0,
    puntosEnCirculacion: filas.reduce((a, c) => a + Number(c.puntos ?? 0), 0),
    clientesConPuntos: filas.filter((c) => Number(c.puntos ?? 0) > 0).length,
  }
}

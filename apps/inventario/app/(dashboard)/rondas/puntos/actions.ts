'use server'

// Escrituras de zonas y puntos de control (F2 del módulo de Puntos QR).
//
// Van por server action + RLS, no por RPC: no hay máquina de estados ni
// consecutivo que proteger, y la política de la migración ya exige
// `gestionar_puntos_ronda` MÁS el contrato en el alcance (`auth_grupos()`).
// `faltaPermiso` está igual para dar un mensaje legible en vez del crudo
// "row-level security".
//
// `grupo_id` y `sede_nombre` NO se mandan nunca desde aquí: los deriva el
// trigger `ronda_puntos_derivar()` a partir de la sede. Es a propósito —
// `grupo_id` es la columna por la que filtra la RLS, y si la pantalla pudiera
// elegirla, un error de formulario metería un punto de un contrato en otro.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import { ESTADOS_PUNTO, type EstadoPunto } from '@/lib/puntos-qr'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

const PERMISO = 'gestionar_puntos_ronda'

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}
function numero(fd: FormData, campo: string): number | null {
  const s = texto(fd, campo)
  if (s === null) return null
  const n = Number(s.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function entero(fd: FormData, campo: string, porDefecto: number): number {
  const n = numero(fd, campo)
  return n === null ? porDefecto : Math.round(n)
}
const marcado = (fd: FormData, campo: string) => fd.get(campo) === 'on' || fd.get(campo) === 'true'

function hora(fd: FormData, campo: string): string | null {
  const s = texto(fd, campo)
  return s && /^\d{2}:\d{2}$/.test(s) ? s : null
}

function traducir(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: esa sede no está en tu alcance de contratos.'
  }
  if (msg.includes('ux_ronda_puntos_codigo')) {
    return 'Ya hay otro punto con ese código en la misma sede.'
  }
  if (msg.includes('ux_ronda_zonas_codigo')) {
    return 'Ya hay otra zona con ese código en la misma sede.'
  }
  if (msg.includes('zona no pertenece')) {
    return 'La zona que elegiste es de otra sede.'
  }
  if (msg.includes('ronda_puntos_coord_chk')) {
    return 'Faltó una de las dos coordenadas: se capturan juntas o no se capturan.'
  }
  if (msg.includes('geocerca_metros')) {
    return 'El radio de la geocerca tiene que estar entre 5 y 2.000 metros.'
  }
  if (msg.includes('ronda_puntos_dias_chk')) {
    return 'Hay que marcar al menos un día de la semana.'
  }
  if (msg.includes('ronda_puntos_horario_chk')) {
    return 'La hora de inicio y la de fin no pueden ser la misma.'
  }
  if (msg.includes('violates foreign key') && msg.includes('ronda_qr')) {
    return 'Ese punto ya tiene códigos QR emitidos: revócalos antes de eliminarlo.'
  }
  return 'No se pudo guardar: ' + msg
}

async function cliente() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, user }
}

function refrescar(puntoId?: string | null) {
  revalidatePath('/rondas/puntos')
  revalidatePath('/rondas/qr')
  if (puntoId) revalidatePath(`/rondas/puntos/${puntoId}`)
}

// ──────────────────────────────────────────────────────────────────────────────
// Zonas
// ──────────────────────────────────────────────────────────────────────────────

export async function guardarZona(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const id = texto(fd, 'id')
  const sedeId = texto(fd, 'sede_id')
  const codigo = texto(fd, 'codigo')
  const nombre = texto(fd, 'nombre')
  if (!sedeId) return { error: 'Elige la sede de la zona.' }
  if (!codigo) return { error: 'La zona necesita un código corto.' }
  if (!nombre) return { error: 'La zona necesita un nombre.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const fila = {
    sede_id: sedeId,
    codigo: codigo.toUpperCase(),
    nombre,
    piso: texto(fd, 'piso'),
    orden: entero(fd, 'orden', 0),
    activo: marcado(fd, 'activo'),
  }

  if (id) {
    const { error } = await sb.from('ronda_zonas').update(fila).eq('id', id)
    if (error) return { error: traducir(error.message) }
    refrescar()
    return { ok: true, id }
  }
  const { data, error } = await sb.from('ronda_zonas')
    .insert({ ...fila, created_by: user.id }).select('id').single()
  if (error) return { error: traducir(error.message) }
  refrescar()
  return { ok: true, id: data?.id }
}

export async function eliminarZona(fd: FormData): Promise<void> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  const { sb } = await cliente()
  // Los puntos de la zona NO se borran: la FK es ON DELETE SET NULL, así que
  // quedan sin zona pero siguen existiendo (y sus QR impresos siguen sirviendo).
  await sb.from('ronda_zonas').delete().eq('id', id)
  refrescar()
}

// ──────────────────────────────────────────────────────────────────────────────
// Puntos de control
// ──────────────────────────────────────────────────────────────────────────────

export async function guardarPunto(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const id = texto(fd, 'id')
  const sedeId = texto(fd, 'sede_id')
  const codigo = texto(fd, 'codigo')
  const nombre = texto(fd, 'nombre')
  if (!sedeId) return { error: 'Elige la sede del punto.' }
  if (!codigo) return { error: 'El punto necesita un código corto.' }
  if (!nombre) return { error: 'El punto necesita un nombre.' }

  const estado = (texto(fd, 'estado') ?? 'BORRADOR') as EstadoPunto
  if (!ESTADOS_PUNTO.includes(estado)) return { error: 'Estado no válido.' }

  // Las dos coordenadas o ninguna: media coordenada no ubica nada, y la base
  // lo rechaza. Se avisa aquí para no mostrar un error de CHECK.
  const lat = numero(fd, 'lat')
  const lng = numero(fd, 'lng')
  if ((lat === null) !== (lng === null)) {
    return { error: 'Captura la ubicación completa o déjala vacía.' }
  }
  if (lat !== null && (lat < -90 || lat > 90 || (lng ?? 0) < -180 || (lng ?? 0) > 180)) {
    return { error: 'Las coordenadas capturadas están fuera de rango.' }
  }

  const geocerca = entero(fd, 'geocerca_metros', 30)
  if (geocerca < 5 || geocerca > 2000) {
    return { error: 'El radio de la geocerca tiene que estar entre 5 y 2.000 metros.' }
  }

  const dias = fd.getAll('horario_dias').map((d) => Number(d))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 7)
  if (dias.length === 0) return { error: 'Marca al menos un día de la semana.' }

  const desde = hora(fd, 'horario_desde')
  const hasta = hora(fd, 'horario_hasta')
  if (desde && hasta && desde === hasta) {
    return { error: 'La hora de inicio y la de fin no pueden ser la misma.' }
  }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const fila = {
    sede_id: sedeId,
    zona_id: texto(fd, 'zona_id'),
    codigo: codigo.toUpperCase(),
    nombre,
    descripcion: texto(fd, 'descripcion'),
    piso: texto(fd, 'piso'),
    lat,
    lng,
    // La precisión se guarda TAL COMO la reportó el GPS en el momento de la
    // captura: si fue mala, la geocerca de este punto no es confiable y la
    // pantalla lo tiene que poder decir. No se redondea ni se maquilla.
    precision_metros: numero(fd, 'precision_metros'),
    geocerca_metros: geocerca,
    exige_geocerca: marcado(fd, 'exige_geocerca'),
    horario_dias: dias.sort((a, b) => a - b),
    horario_desde: desde,
    horario_hasta: hasta,
    orden: entero(fd, 'orden', 0),
    estado,
  }

  if (id) {
    const { error } = await sb.from('ronda_puntos').update(fila).eq('id', id)
    if (error) return { error: traducir(error.message) }
    refrescar(id)
    return { ok: true, id }
  }
  const { data, error } = await sb.from('ronda_puntos')
    .insert({ ...fila, created_by: user.id }).select('id').single()
  if (error) return { error: traducir(error.message) }
  refrescar(data?.id)
  return { ok: true, id: data?.id }
}

export async function eliminarPunto(fd: FormData): Promise<void> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return
  const id = String(fd.get('id') ?? '')
  if (!id) return
  const { sb } = await cliente()
  // Un punto con QR emitidos NO se borra: los códigos cuelgan de él con
  // ON DELETE CASCADE y borrarlos dejaría placas pegadas en la pared sin nada
  // detrás. Para sacarlo de la operación está el estado RETIRADO.
  const { count } = await sb.from('ronda_qr')
    .select('id', { count: 'exact', head: true }).eq('punto_id', id)
  if ((count ?? 0) > 0) {
    await sb.from('ronda_puntos').update({ estado: 'RETIRADO' }).eq('id', id)
  } else {
    await sb.from('ronda_puntos').delete().eq('id', id)
  }
  refrescar()
}

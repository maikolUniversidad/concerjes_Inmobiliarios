'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { correosInvalidos, esCorreo, separarCorreos } from '@/lib/notificaciones/correos'

export interface ResultadoDirectorio { ok?: boolean; error?: string; aviso?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

const RUTA = '/notificaciones/directorio'
const MODULO = 'Directorio de correos'

async function auth(...permisos: string[]) {
  const supabase = (await createClient()) as DB
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { supabase, error: 'Debes iniciar sesión.' }
  const p = await getPermisosUsuario()
  if (!permisos.some((x) => p.puede(x))) return { supabase, error: 'No tienes permiso para esta acción.' }
  return { supabase, error: null }
}

const texto = (v: unknown, max = 300) => {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

/** Valida el correo principal y las copias; devuelve el error legible o los datos limpios. */
function correos(principal: unknown, copias: unknown): { error: string } | { correo: string | null; copia: string[] } {
  const correo = texto(principal, 200)
  if (correo && !esCorreo(correo)) return { error: `«${correo}» no es un correo válido.` }
  const copiasTxt = String(copias ?? '')
  const malos = correosInvalidos(copiasTxt)
  if (malos.length) return { error: `Revisa los correos en copia: ${malos.join(', ')}` }
  const copia = separarCorreos(copiasTxt).filter((c) => c !== correo?.toLowerCase())
  return { correo: correo ? correo.toLowerCase() : null, copia }
}

// ── Centros médicos (tabla ips) ─────────────────────────────────────────────
export interface DatosCentroMedico {
  id?: string | null
  nombre: string
  correo: string
  correos_copia: string
  telefono: string
  direccion: string
  ciudad: string
  contacto: string
  notas: string
  activo: boolean
}

export async function guardarCentroMedico(d: DatosCentroMedico): Promise<ResultadoDirectorio> {
  const { supabase, error } = await auth('gestionar_directorio_correos', 'gestionar_postulaciones')
  if (error) return { error }
  const nombre = texto(d.nombre, 150)?.toUpperCase()
  if (!nombre) return { error: 'Escribe el nombre del centro médico.' }
  const c = correos(d.correo, d.correos_copia)
  if ('error' in c) return { error: c.error }

  const fila = {
    nombre, correo: c.correo, correos_copia: c.copia,
    telefono: texto(d.telefono, 80), direccion: texto(d.direccion), ciudad: texto(d.ciudad, 120)?.toUpperCase() ?? null,
    contacto: texto(d.contacto, 150), notas: texto(d.notas, 1000), activo: !!d.activo,
  }
  let r
  if (d.id) {
    r = await supabase.from('ips').update(fila).eq('id', d.id)
  } else {
    const { data: ultimo } = await supabase.from('ips').select('orden').order('orden', { ascending: false }).limit(1).maybeSingle()
    r = await supabase.from('ips').insert({ ...fila, orden: ((ultimo?.orden as number | undefined) ?? 0) + 1 })
  }
  if (r.error) {
    return { error: r.error.code === '23505' ? 'Ya existe un centro médico con ese nombre.' : r.error.message }
  }
  await logActivity(supabase, {
    accion: d.id ? 'EDITAR' : 'CREAR', modulo: MODULO, descripcion: `Centro médico ${nombre}`, entidad: 'ips', entidad_id: d.id ?? undefined,
  })
  revalidatePath(RUTA)
  return { ok: true }
}

/** Borra el centro médico; si ya tiene remisiones, solo lo desactiva (queda el historial). */
export async function eliminarCentroMedico(id: string): Promise<ResultadoDirectorio> {
  const { supabase, error } = await auth('gestionar_directorio_correos', 'gestionar_postulaciones')
  if (error) return { error }
  const { count } = await supabase.from('candidatos').select('id', { count: 'exact', head: true }).eq('ips_id', id)
  if ((count ?? 0) > 0) {
    const r = await supabase.from('ips').update({ activo: false }).eq('id', id)
    if (r.error) return { error: r.error.message }
    revalidatePath(RUTA)
    return { ok: true, aviso: `Tiene ${count} remisión(es) registrada(s): se desactivó en lugar de borrarlo.` }
  }
  const r = await supabase.from('ips').delete().eq('id', id)
  if (r.error) return { error: r.error.message }
  await logActivity(supabase, { accion: 'ELIMINAR', modulo: MODULO, descripcion: 'Centro médico eliminado', entidad: 'ips', entidad_id: id })
  revalidatePath(RUTA)
  return { ok: true }
}

// ── Listas de distribución ──────────────────────────────────────────────────
export interface DatosLista {
  codigo?: string | null   // vacío = lista nueva
  nombre: string
  descripcion: string
  uso: string
  activo: boolean
}

function codigoDesde(nombre: string): string {
  return nombre.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50) || 'LISTA'
}

export async function guardarLista(d: DatosLista): Promise<ResultadoDirectorio> {
  const { supabase, error } = await auth('gestionar_directorio_correos')
  if (error) return { error }
  const nombre = texto(d.nombre, 150)
  if (!nombre) return { error: 'Escribe el nombre de la lista.' }
  const fila = { nombre, descripcion: texto(d.descripcion, 1000), uso: texto(d.uso, 1000), activo: !!d.activo }
  const r = d.codigo
    ? await supabase.from('directorio_listas').update(fila).eq('codigo', d.codigo)
    : await supabase.from('directorio_listas').insert({ ...fila, codigo: codigoDesde(nombre) })
  if (r.error) return { error: r.error.code === '23505' ? 'Ya existe una lista con ese nombre.' : r.error.message }
  await logActivity(supabase, { accion: d.codigo ? 'EDITAR' : 'CREAR', modulo: MODULO, descripcion: `Lista ${nombre}` })
  revalidatePath(RUTA)
  return { ok: true }
}

export async function eliminarLista(codigo: string): Promise<ResultadoDirectorio> {
  const { supabase, error } = await auth('gestionar_directorio_correos')
  if (error) return { error }
  const { data: lista } = await supabase.from('directorio_listas').select('es_sistema, nombre').eq('codigo', codigo).maybeSingle()
  if (!lista) return { error: 'La lista ya no existe.' }
  if (lista.es_sistema) return { error: 'Es una lista que usa la plataforma: puedes desactivarla, pero no borrarla.' }
  const { data: usos } = await supabase.rpc('directorio_usos')
  const flujos = ((usos ?? []) as { destino: string; flujo: string }[]).filter((u) => u.destino === `lista:${codigo}`)
  if (flujos.length) return { error: `La usa el flujo «${flujos[0].flujo}». Quítala de ese flujo antes de borrarla.` }
  const r = await supabase.from('directorio_listas').delete().eq('codigo', codigo)
  if (r.error) return { error: r.error.message }
  await logActivity(supabase, { accion: 'ELIMINAR', modulo: MODULO, descripcion: `Lista ${lista.nombre}` })
  revalidatePath(RUTA)
  return { ok: true }
}

// ── Contactos de una lista ──────────────────────────────────────────────────
export interface DatosContacto {
  id?: string | null
  lista_codigo: string
  nombre: string
  cargo: string
  correo: string
  correos_copia: string
  telefono: string
  notas: string
  activo: boolean
}

export async function guardarContacto(d: DatosContacto): Promise<ResultadoDirectorio> {
  const { supabase, error } = await auth('gestionar_directorio_correos')
  if (error) return { error }
  const nombre = texto(d.nombre, 150)
  if (!nombre) return { error: 'Escribe el nombre del contacto o del buzón.' }
  if (!d.lista_codigo) return { error: 'Falta la lista.' }
  const c = correos(d.correo, d.correos_copia)
  if ('error' in c) return { error: c.error }
  const fila = {
    lista_codigo: d.lista_codigo, nombre, cargo: texto(d.cargo, 150), correo: c.correo, correos_copia: c.copia,
    telefono: texto(d.telefono, 80), notas: texto(d.notas, 1000), activo: !!d.activo,
  }
  const r = d.id
    ? await supabase.from('directorio_contactos').update(fila).eq('id', d.id)
    : await supabase.from('directorio_contactos').insert(fila)
  if (r.error) return { error: r.error.message }
  await logActivity(supabase, { accion: d.id ? 'EDITAR' : 'CREAR', modulo: MODULO, descripcion: `Contacto ${nombre} (${d.lista_codigo})` })
  revalidatePath(RUTA)
  return { ok: true, aviso: c.correo ? undefined : 'Guardado sin correo: no recibirá avisos hasta que se lo agregues.' }
}

export async function eliminarContacto(id: string): Promise<ResultadoDirectorio> {
  const { supabase, error } = await auth('gestionar_directorio_correos')
  if (error) return { error }
  const r = await supabase.from('directorio_contactos').delete().eq('id', id)
  if (r.error) return { error: r.error.message }
  await logActivity(supabase, { accion: 'ELIMINAR', modulo: MODULO, descripcion: 'Contacto eliminado', entidad: 'directorio_contactos', entidad_id: id })
  revalidatePath(RUTA)
  return { ok: true }
}

// ── Correos de la empresa (vac_empresa) ─────────────────────────────────────
export interface DatosEmpresa {
  correo_seleccion: string
  correo_datos: string
  telefono: string
  telefono_nomina: string
  contacto_nomina: string
}

export async function guardarEmpresa(d: DatosEmpresa): Promise<ResultadoDirectorio> {
  const { supabase, error } = await auth('gestionar_directorio_correos', 'gestionar_postulaciones')
  if (error) return { error }
  for (const [campo, etiqueta] of [['correo_seleccion', 'de selección'], ['correo_datos', 'de datos personales']] as const) {
    const v = texto(d[campo], 200)
    if (v && !esCorreo(v)) return { error: `El correo ${etiqueta} no es válido.` }
  }
  const r = await supabase.from('vac_empresa').update({
    correo_seleccion: texto(d.correo_seleccion, 200)?.toLowerCase() ?? null,
    correo_datos: texto(d.correo_datos, 200)?.toLowerCase() ?? null,
    telefono: texto(d.telefono, 80), telefono_nomina: texto(d.telefono_nomina, 80), contacto_nomina: texto(d.contacto_nomina, 150),
  }).eq('id', 1)
  if (r.error) return { error: r.error.message }
  await logActivity(supabase, { accion: 'EDITAR', modulo: MODULO, descripcion: 'Correos y teléfonos de la empresa' })
  revalidatePath(RUTA)
  return { ok: true }
}

'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import { IMPORT_CONFIGS, parseBool, type EntityConfig } from '@/lib/import/config'

export interface FilaCommit { fila: number; clave: string; datos: Record<string, unknown> }
export interface ImportResultRow { fila: number; clave: string; accion: 'creado' | 'actualizado' | 'error'; error?: string }
export interface ImportResult {
  ok: boolean
  total: number
  creados: number
  actualizados: number
  errores: number
  detalle: ImportResultRow[]
  error?: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = any

async function buscarExistente(supabase: DB, config: EntityConfig, datos: Record<string, unknown>): Promise<string | null> {
  for (const mk of config.matchKeys) {
    const val = datos[mk]
    if (val === undefined || val === null || String(val).trim() === '') continue
    const { data } = await supabase.from(config.id).select('id').eq(mk, val).limit(1).maybeSingle()
    if (data?.id) return data.id as string
  }
  return null
}

async function upsertProducto(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  const payload: Record<string, unknown> = {
    nombre_estandar: datos.nombre_estandar,
    presentacion: datos.presentacion ?? null,
    tipo_insumo: datos.tipo_insumo ?? 'OTROS',
    cat_rotacion: datos.cat_rotacion ?? 'C',
    stock_minimo_def: datos.stock_minimo_def ?? 0,
    precio_lista: datos.precio_lista ?? null,
    complemento: datos.complemento ?? null,
    ref: datos.ref ?? null,
    codigo: datos.codigo ?? null,
  }
  if (id) {
    const { error } = await supabase.from('productos').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return 'actualizado'
  }
  const { data, error } = await supabase.from('productos').insert(payload).select('id').single()
  if (error) throw new Error(error.message)
  const stockInicial = Number(datos.stock_inicial ?? 0) || 0
  await supabase.from('stock').insert({ producto_id: data.id, cantidad_real: stockInicial, cantidad_disp: stockInicial })
  return 'creado'
}

async function upsertProveedor(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  const payload = {
    nombre: datos.nombre,
    nit: datos.nit ?? null,
    contacto: datos.contacto ?? null,
    telefono: datos.telefono ?? null,
    email: datos.email ?? null,
    es_principal: parseBool(datos.es_principal),
  }
  if (id) {
    const { error } = await supabase.from('proveedores').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return 'actualizado'
  }
  const { error } = await supabase.from('proveedores').insert(payload)
  if (error) throw new Error(error.message)
  return 'creado'
}

async function upsertUsuario(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  const payload: Record<string, unknown> = {
    nombre: datos.nombre,
    email: datos.email,
    rol: datos.rol ?? 'AUDITOR',
    telefono: datos.telefono ?? null,
    activo: datos.activo === null || datos.activo === undefined ? true : parseBool(datos.activo),
  }
  if (id) {
    const { error } = await supabase.from('usuarios').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return 'actualizado'
  }
  const { error } = await supabase.from('usuarios').insert({ id: crypto.randomUUID(), ...payload })
  if (error) throw new Error(error.message)
  return 'creado'
}

function parseFecha(v: unknown): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  // AAAA-MM-DD
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  // DD/MM/AAAA
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

async function resolverEmpresaUsuaria(supabase: DB, nombre: unknown): Promise<string | null> {
  const n = String(nombre ?? '').trim()
  if (!n) return null
  const { data } = await supabase.from('empresas_usuarias').select('id').ilike('nombre', n).limit(1).maybeSingle()
  if (data?.id) return data.id as string
  // No existe → crear (conveniencia para el cargue masivo)
  const { data: creada } = await supabase.from('empresas_usuarias').insert({ nombre: n }).select('id').single()
  return creada?.id ?? null
}

async function resolverSede(supabase: DB, nombre: unknown): Promise<string | null> {
  const n = String(nombre ?? '').trim()
  if (!n) return null
  const { data } = await supabase.from('sedes').select('id').ilike('nombre', n).limit(1).maybeSingle()
  return (data?.id as string) ?? null
}

async function upsertPersona(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  const empresaId = await resolverEmpresaUsuaria(supabase, datos.empresa_usuaria)
  const sedeId = await resolverSede(supabase, datos.sede)
  const payload: Record<string, unknown> = {
    tipo_doc: datos.tipo_doc ?? 'CC',
    documento: String(datos.documento).trim(),
    nombres: datos.nombres,
    apellidos: datos.apellidos,
    cargo: datos.cargo ?? null,
    empresa_usuaria_id: empresaId,
    sede_id: sedeId,
    fecha_ingreso: parseFecha(datos.fecha_ingreso),
    estado: datos.estado ?? 'ACTIVO',
    email: datos.email ?? null,
    telefono: datos.telefono ?? null,
    direccion: datos.direccion ?? null,
    eps: datos.eps ?? null,
    arl: datos.arl ?? null,
  }
  if (id) {
    const { error } = await supabase.from('personas').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return 'actualizado'
  }
  const { error } = await supabase.from('personas').insert(payload)
  if (error) throw new Error(error.message)
  return 'creado'
}

async function upsertEmpresaUsuaria(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  const payload = {
    nombre: datos.nombre,
    nit: datos.nit ?? null,
    ciudad: datos.ciudad ?? null,
    contacto: datos.contacto ?? null,
    telefono: datos.telefono ?? null,
    email: datos.email ?? null,
  }
  if (id) {
    const { error } = await supabase.from('empresas_usuarias').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return 'actualizado'
  }
  const { error } = await supabase.from('empresas_usuarias').insert(payload)
  if (error) throw new Error(error.message)
  return 'creado'
}

async function upsertSede(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  // Resolver grupo de contrato por código (CA, MO, MB, PB, AD)
  const codigo = String(datos.grupo ?? '').trim().toUpperCase()
  const { data: grupo } = await supabase.from('grupos_contrato').select('id').eq('codigo', codigo).limit(1).maybeSingle()
  if (!grupo?.id) throw new Error(`Grupo "${codigo}" no existe (usa CA, MO, MB, PB o AD).`)
  const payload = {
    grupo_id: grupo.id,
    nombre: datos.nombre,
    codigo_interno: datos.codigo_interno ?? null,
    zona: datos.zona ?? null,
    ciudad: datos.ciudad ?? 'BOGOTÁ D.C.',
  }
  if (id) {
    const { error } = await supabase.from('sedes').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return 'actualizado'
  }
  const { error } = await supabase.from('sedes').insert(payload)
  if (error) throw new Error(error.message)
  return 'creado'
}

export async function importarEntidad(entidad: string, rows: FilaCommit[], archivo: string): Promise<ImportResult> {
  const config = IMPORT_CONFIGS[entidad]
  if (!config) return { ok: false, total: 0, creados: 0, actualizados: 0, errores: 0, detalle: [], error: 'Entidad no válida.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, total: 0, creados: 0, actualizados: 0, errores: 0, detalle: [], error: 'Debes iniciar sesión.' }

  if (rows.length > 2000) return { ok: false, total: rows.length, creados: 0, actualizados: 0, errores: 0, detalle: [], error: 'Máximo 2000 filas por carga.' }

  const detalle: ImportResultRow[] = []
  let creados = 0, actualizados = 0, errores = 0

  for (const row of rows) {
    try {
      const id = await buscarExistente(supabase, config, row.datos)
      let accion: 'creado' | 'actualizado'
      if (entidad === 'productos') accion = await upsertProducto(supabase, row.datos, id)
      else if (entidad === 'proveedores') accion = await upsertProveedor(supabase, row.datos, id)
      else if (entidad === 'personas') accion = await upsertPersona(supabase, row.datos, id)
      else if (entidad === 'empresas_usuarias') accion = await upsertEmpresaUsuaria(supabase, row.datos, id)
      else if (entidad === 'sedes') accion = await upsertSede(supabase, row.datos, id)
      else accion = await upsertUsuario(supabase, row.datos, id)

      if (accion === 'creado') creados++; else actualizados++
      detalle.push({ fila: row.fila, clave: row.clave, accion })
    } catch (e) {
      errores++
      const msg = e instanceof Error ? e.message : 'Error desconocido'
      detalle.push({ fila: row.fila, clave: row.clave, accion: 'error', error: traducir(msg) })
    }
  }

  // Registro del lote
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).from('importaciones').insert({
    entidad, archivo_nombre: archivo, total: rows.length, creados, actualizados, errores,
    detalle, usuario_id: user.id, usuario_email: user.email,
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await logActivity(supabase as any, {
    accion: 'IMPORTAR',
    modulo: 'Cargas masivas',
    descripcion: `Carga masiva de ${config.label}: ${creados} creados, ${actualizados} actualizados, ${errores} errores`,
    entidad,
    detalle: { creados, actualizados, errores, archivo },
  })

  revalidatePath(`/${entidad}`)
  revalidatePath('/importar')
  revalidatePath('/dashboard')
  revalidatePath('/historial')

  return { ok: true, total: rows.length, creados, actualizados, errores, detalle }
}

function traducir(msg: string): string {
  if (msg.includes('row-level security')) return 'Sin permisos para esta entidad.'
  if (msg.includes('duplicate')) return 'Valor duplicado (clave única en conflicto).'
  if (msg.includes('invalid input value for enum')) return 'Valor de lista (enum) inválido.'
  return msg
}

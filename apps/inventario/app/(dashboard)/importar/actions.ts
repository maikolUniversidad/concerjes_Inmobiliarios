'use server'

import { revalidatePath } from 'next/cache'
import { createClient as createAdminSb } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { logActivity } from '@/lib/activity'
import { IMPORT_CONFIGS, aFecha, normalizaClave, type EntityConfig } from '@/lib/import/config'
import { faltaPermiso } from '@/lib/permisos-server'

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

// ── Provisión de cuentas para el cargue masivo de personas ───────────────────
// Cada persona nueva queda con acceso a la plataforma (rol por defecto Conserje,
// login = documento). Requiere service role (auth admin).
function adminSb(): DB {
  return createAdminSb(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function loginEmailFor(email: unknown, documento: string): string {
  const e = String(email ?? '').trim().toLowerCase()
  if (e && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return e
  return `${documento.replace(/[^a-z0-9]/gi, '')}@conserje.local`
}

function pwdFor(documento: string): string {
  return documento.length >= 6 ? documento : documento.padStart(6, '0')
}

interface PersonasCtx {
  admin: DB
  userId: string
  rolConserjeId: string | null
  /** nombre de rol (minúsculas) → id */
  rolesPorNombre: Map<string, string>
}

async function crearCtxPersonas(userId: string): Promise<PersonasCtx | null> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  const admin = adminSb()
  const { data: roles } = await admin.from('roles').select('id, nombre').eq('activo', true)
  const rolesPorNombre = new Map<string, string>()
  for (const r of (roles ?? []) as { id: string; nombre: string }[]) {
    rolesPorNombre.set(r.nombre.trim().toLowerCase(), r.id)
  }
  return { admin, userId, rolConserjeId: rolesPorNombre.get('conserje') ?? null, rolesPorNombre }
}

/** Crea (o reutiliza) la cuenta de acceso y devuelve su id de usuario. */
async function provisionCuenta(ctx: PersonasCtx, datos: Record<string, unknown>): Promise<string> {
  const documento = String(datos.documento).trim()
  const nombre = `${String(datos.nombres ?? '').trim()} ${String(datos.apellidos ?? '').trim()}`.trim()
  const loginEmail = loginEmailFor(datos.email, documento)
  const rolId = ctx.rolesPorNombre.get(String(datos.rol ?? '').trim().toLowerCase()) ?? ctx.rolConserjeId

  const { data: authData, error: authErr } = await ctx.admin.auth.admin.createUser({
    email: loginEmail,
    password: pwdFor(documento),
    email_confirm: true,
    user_metadata: { nombre },
  })

  let uid: string | undefined = authData?.user?.id
  if (authErr || !uid) {
    const m = (authErr?.message ?? '').toLowerCase()
    if (m.includes('already') || m.includes('registered') || m.includes('exists')) {
      // Reutiliza la cuenta existente con ese email de login.
      const { data: existente } = await ctx.admin.from('usuarios').select('id').eq('email', loginEmail).maybeSingle()
      uid = (existente?.id as string) ?? undefined
    }
    if (!uid) throw new Error(authErr?.message ?? 'No se pudo crear la cuenta de acceso.')
  }

  await ctx.admin.from('usuarios').update({ nombre, rol_id: rolId, activo: true }).eq('id', uid)
  return uid
}

/**
 * Copia al payload SOLO los campos que vienen en el archivo.
 *
 * Antes se enviaban todas las columnas con `?? null`: actualizar un producto con
 * un Excel de dos columnas le borraba la presentación, el precio y el proveedor,
 * y le ponía tipo_insumo = OTROS. Lo que el archivo no trae, no se toca.
 */
function soloPresentes(
  datos: Record<string, unknown>,
  campos: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of campos) {
    const v = datos[c]
    if (v !== undefined && v !== null && String(v).trim() !== '') out[c] = v
  }
  return out
}

/** Aplica el payload: UPDATE si ya existe (sin pisar lo ausente), INSERT si es nuevo. */
async function guardar(
  supabase: DB, tabla: string, id: string | null,
  campos: Record<string, unknown>, porDefecto: Record<string, unknown> = {},
): Promise<'creado' | 'actualizado'> {
  if (id) {
    if (Object.keys(campos).length === 0) return 'actualizado' // nada que cambiar
    const { error } = await supabase.from(tabla).update(campos).eq('id', id)
    if (error) throw new Error(error.message)
    return 'actualizado'
  }
  const { error } = await supabase.from(tabla).insert({ ...porDefecto, ...campos })
  if (error) throw new Error(error.message)
  return 'creado'
}

async function buscarExistente(supabase: DB, config: EntityConfig, datos: Record<string, unknown>): Promise<string | null> {
  for (const mk of config.matchKeys) {
    const val = datos[mk]
    if (val === undefined || val === null || String(val).trim() === '') continue
    const col = config.columns.find((c) => c.key === mk)
    // El preview compara en minúsculas; para texto se busca igual (ilike) para
    // que "DETALGRAF" y "Detalgraf" no terminen creando dos proveedores.
    const q = supabase.from(config.id).select('id')
    const { data } = await (col?.type === 'number'
      ? q.eq(mk, val)
      : q.ilike(mk, String(val))).limit(1).maybeSingle()
    if (data?.id) return data.id as string
  }
  return null
}

const CAMPOS_PRODUCTO = [
  'nombre_estandar', 'presentacion', 'tipo_insumo', 'cat_rotacion',
  'stock_minimo_def', 'precio_lista', 'complemento', 'ref', 'codigo',
] as const

async function upsertProducto(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  const campos = soloPresentes(datos, CAMPOS_PRODUCTO)
  if (id) return guardar(supabase, 'productos', id, campos)

  const { data, error } = await supabase.from('productos')
    .insert({ tipo_insumo: 'OTROS', cat_rotacion: 'C', stock_minimo_def: 0, ...campos })
    .select('id').single()
  if (error) throw new Error(error.message)

  const stockInicial = Number(datos.stock_inicial ?? 0) || 0
  await supabase.from('stock').insert({ producto_id: data.id, cantidad_real: stockInicial, cantidad_disp: stockInicial })
  return 'creado'
}

const CAMPOS_PROVEEDOR = ['nombre', 'nit', 'contacto', 'telefono', 'email', 'es_principal'] as const

async function upsertProveedor(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  return guardar(supabase, 'proveedores', id,
    soloPresentes(datos, CAMPOS_PROVEEDOR), { es_principal: false })
}

const CAMPOS_USUARIO = ['nombre', 'email', 'rol', 'telefono', 'activo'] as const

async function upsertUsuario(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  return guardar(supabase, 'usuarios', id, soloPresentes(datos, CAMPOS_USUARIO),
    { id: crypto.randomUUID(), rol: 'AUDITOR', activo: true })
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

const CAMPOS_PERSONA = [
  'tipo_doc', 'documento', 'nombres', 'apellidos', 'cargo', 'estado',
  'email', 'telefono', 'direccion', 'eps', 'arl',
] as const

async function upsertPersona(supabase: DB, datos: Record<string, unknown>, id: string | null, ctx: PersonasCtx | null): Promise<'creado' | 'actualizado'> {
  const payload: Record<string, unknown> = soloPresentes(datos, CAMPOS_PERSONA)
  if (payload.documento) payload.documento = String(payload.documento).trim()

  // Las relaciones solo se tocan si el archivo trae la columna.
  if (datos.empresa_usuaria) payload.empresa_usuaria_id = await resolverEmpresaUsuaria(supabase, datos.empresa_usuaria)
  if (datos.sede) {
    const sedeId = await resolverSede(supabase, datos.sede)
    if (!sedeId) throw new Error(`La sede "${String(datos.sede).trim()}" no existe.`)
    payload.sede_id = sedeId
  }
  if (datos.fecha_ingreso) {
    const f = aFecha(datos.fecha_ingreso)
    if (!f) throw new Error('La fecha de ingreso no es válida (usa AAAA-MM-DD o DD/MM/AAAA).')
    payload.fecha_ingreso = f
  }
  if (!id) {
    payload.tipo_doc ??= 'CC'
    payload.estado ??= 'ACTIVO'
  }

  if (id) {
    // Actualiza los datos; no altera la cuenta de acceso existente.
    const { error } = await supabase.from('personas').update(payload).eq('id', id)
    if (error) throw new Error(error.message)
    return 'actualizado'
  }
  // Persona nueva → provisiona su cuenta de acceso y la enlaza.
  if (ctx) {
    const usuarioId = await provisionCuenta(ctx, datos)
    const { error } = await ctx.admin.from('personas').insert({ ...payload, usuario_id: usuarioId, created_by: ctx.userId })
    if (error) throw new Error(error.message)
    return 'creado'
  }
  // Sin service role configurado → crea la persona sin acceso (degradado).
  const { error } = await supabase.from('personas').insert(payload)
  if (error) throw new Error(error.message)
  return 'creado'
}

const CAMPOS_EMPRESA = ['nombre', 'nit', 'ciudad', 'contacto', 'telefono', 'email'] as const

async function upsertEmpresaUsuaria(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  return guardar(supabase, 'empresas_usuarias', id, soloPresentes(datos, CAMPOS_EMPRESA))
}

const CAMPOS_SEDE = ['nombre', 'codigo_interno', 'zona', 'ciudad'] as const

async function upsertSede(supabase: DB, datos: Record<string, unknown>, id: string | null): Promise<'creado' | 'actualizado'> {
  const payload: Record<string, unknown> = soloPresentes(datos, CAMPOS_SEDE)

  // El grupo de contrato solo se resuelve (y se cambia) si viene en el archivo.
  if (datos.grupo) {
    const codigo = String(datos.grupo).trim().toUpperCase()
    const { data: grupo } = await supabase.from('grupos_contrato').select('id').eq('codigo', codigo).limit(1).maybeSingle()
    if (!grupo?.id) throw new Error(`Grupo "${codigo}" no existe (usa CA, MO, MB, PB o AD).`)
    payload.grupo_id = grupo.id
  } else if (!id) {
    throw new Error('Falta el grupo de contrato para crear la sede.')
  }

  return guardar(supabase, 'sedes', id, payload, { ciudad: 'BOGOTÁ D.C.' })
}

export async function importarEntidad(entidad: string, rows: FilaCommit[], archivo: string): Promise<ImportResult> {
  const falta = await faltaPermiso('importar_datos')
  if (falta) return { ok: false, total: 0, creados: 0, actualizados: 0, errores: 0, detalle: [], error: falta }

  const config = IMPORT_CONFIGS[entidad]
  if (!config) return { ok: false, total: 0, creados: 0, actualizados: 0, errores: 0, detalle: [], error: 'Entidad no válida.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, total: 0, creados: 0, actualizados: 0, errores: 0, detalle: [], error: 'Debes iniciar sesión.' }

  if (rows.length > 2000) return { ok: false, total: rows.length, creados: 0, actualizados: 0, errores: 0, detalle: [], error: 'Máximo 2000 filas por carga.' }

  const detalle: ImportResultRow[] = []
  let creados = 0, actualizados = 0, errores = 0

  // Contexto para provisionar cuentas de acceso al importar personas.
  const personasCtx = entidad === 'personas' ? await crearCtxPersonas(user.id) : null

  // Segunda barrera contra repetidos: el preview ya los marca, pero el servidor
  // no debe confiar en lo que le mandó el navegador.
  const clavesVistas = new Set<string>()

  for (const row of rows) {
    try {
      const datos = soloColumnasDeLaPlantilla(config, row.datos)

      const huella = huellaDe(config, datos)
      if (huella && clavesVistas.has(huella)) {
        throw new Error('Fila repetida dentro del mismo archivo; se cargó solo la primera.')
      }
      if (huella) clavesVistas.add(huella)

      row.datos = datos
      const id = await buscarExistente(supabase, config, row.datos)
      let accion: 'creado' | 'actualizado'
      if (entidad === 'productos') accion = await upsertProducto(supabase, row.datos, id)
      else if (entidad === 'proveedores') accion = await upsertProveedor(supabase, row.datos, id)
      else if (entidad === 'personas') accion = await upsertPersona(supabase, row.datos, id, personasCtx)
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

/** Descarta cualquier campo que no sea una columna declarada en la plantilla. */
function soloColumnasDeLaPlantilla(config: EntityConfig, datos: Record<string, unknown>): Record<string, unknown> {
  const permitidas = new Set(config.columns.map((c) => c.key))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(datos)) if (permitidas.has(k)) out[k] = v
  return out
}

/** Clave con la que se reconoce una fila (la primera matchKey con valor). */
function huellaDe(config: EntityConfig, datos: Record<string, unknown>): string | null {
  for (const mk of config.matchKeys) {
    const v = datos[mk]
    if (v !== undefined && v !== null && String(v).trim() !== '') return `${mk}:${normalizaClave(v)}`
  }
  return null
}

function traducir(msg: string): string {
  if (msg.includes('row-level security')) return 'Sin permisos para esta entidad.'
  if (msg.includes('duplicate')) return 'Valor duplicado (clave única en conflicto).'
  if (msg.includes('invalid input value for enum')) return 'Valor de lista (enum) inválido.'
  return msg
}

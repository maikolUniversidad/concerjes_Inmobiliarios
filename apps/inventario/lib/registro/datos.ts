// Acceso a datos del flujo público (catálogos + candidato + hijos).
// Convención del repo: escrituras/lecturas con casts laxos (no hay tipos generados).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getSupabase, ensureAnonSession } from '@/lib/supabase/anon'
import { traerTodo } from '@/lib/supabase/paginado'
import type {
  Catalogos, CandidatoForm, DireccionForm, Beneficiario, TipoDocumental, TipoDoc, Estudio, Experiencia, Referencia,
} from './tipos'

export async function fetchCatalogos(): Promise<Catalogos> {
  const sb = getSupabase()
  const [deptos, munis, eps, afp, ces, cajas, bancos, cargos] = await Promise.all([
    sb.from('departamentos').select('codigo_dane, nombre').order('nombre'),
    traerTodo((desde, hasta) => sb.from('municipios').select('codigo_dane, nombre, departamento_codigo')
      .order('nombre').order('codigo_dane').range(desde, hasta)).then((data) => ({ data })),
    sb.from('eps').select('id, nombre').eq('activo', true).order('nombre'),
    sb.from('afp').select('id, nombre').eq('activo', true).order('nombre'),
    sb.from('cesantias').select('id, nombre').eq('activo', true).order('nombre'),
    sb.from('cajas_compensacion').select('id, nombre').eq('activo', true).order('nombre'),
    sb.from('bancos').select('id, nombre').eq('activo', true).order('nombre'),
    sb.from('cargos').select('id, nombre').eq('activo', true).eq('postulable', true).order('nombre'),
  ])
  return {
    departamentos: (deptos.data as any) ?? [],
    municipios: (munis.data as any) ?? [],
    eps: (eps.data as any) ?? [],
    afp: (afp.data as any) ?? [],
    cesantias: (ces.data as any) ?? [],
    cajas: (cajas.data as any) ?? [],
    bancos: (bancos.data as any) ?? [],
    cargos: (cargos.data as any) ?? [],
  }
}

export async function fetchTiposDocumentales(ola = 1): Promise<TipoDocumental[]> {
  const sb = getSupabase()
  const { data } = await sb
    .from('vac_tipos_documentales')
    .select('*')
    .eq('ola', ola)
    .order('orden')
  return ((data as any) ?? []).filter((t: TipoDocumental) => t.activo !== false)
}

/**
 * Carga el candidato de la sesión actual (para reanudar). Trae cualquier fase:
 * antes solo buscaba BORRADOR/POSTULADO y, en cuanto RRHH lo movía de fase, al
 * volver a entrar le aparecía un formulario vacío.
 */
export async function cargarCandidatoActual(): Promise<CandidatoForm | null> {
  const uid = await ensureAnonSession()
  const sb = getSupabase()
  const { data } = await sb
    .from('candidatos')
    .select('*')
    .eq('auth_uid', uid)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as any) ?? null
}

// ── Hoja de vida estructurada (estudios, experiencia, referencias) ──────────
// Se reemplaza la lista completa en cada guardado: son pocas filas y así el
// orden queda igual al que ve el candidato.
async function reemplazar(tabla: string, candidatoId: string, filas: Record<string, unknown>[]): Promise<string | null> {
  const sb = getSupabase()
  const del = await sb.from(tabla).delete().eq('candidato_id', candidatoId)
  if (del.error) return del.error.message
  if (!filas.length) return null
  const ins = await sb.from(tabla).insert(filas.map((f, i) => ({ ...f, candidato_id: candidatoId, orden: i + 1 })) as any)
  return ins.error ? ins.error.message : null
}

const nulo = (v: unknown) => (v === '' || v === undefined ? null : v)

export async function guardarEstudios(candidatoId: string, lista: Estudio[]): Promise<string | null> {
  return reemplazar('candidato_estudios', candidatoId, lista
    .filter((e) => e.nivel && (e.institucion?.trim() || e.titulo?.trim()))
    .map((e) => ({
      nivel: e.nivel, institucion: nulo(e.institucion?.trim()), titulo: nulo(e.titulo?.trim()), ciudad: nulo(e.ciudad?.trim()),
      anio_finalizacion: e.anio_finalizacion ? Number(e.anio_finalizacion) : null, ultimo_curso_aprobado: nulo(e.ultimo_curso_aprobado?.trim()),
      en_curso: !!e.en_curso, intensidad_horaria: nulo(e.intensidad_horaria?.trim()),
    })))
}

export async function guardarExperiencias(candidatoId: string, lista: Experiencia[]): Promise<string | null> {
  return reemplazar('candidato_experiencias', candidatoId, lista
    .filter((e) => e.empresa?.trim())
    .map((e) => ({
      empresa: e.empresa.trim(), cargo: nulo(e.cargo?.trim()), telefono: nulo(e.telefono?.trim()), direccion: nulo(e.direccion?.trim()),
      jefe_inmediato: nulo(e.jefe_inmediato?.trim()), cargo_jefe: nulo(e.cargo_jefe?.trim()), fecha_ingreso: nulo(e.fecha_ingreso),
      fecha_retiro: e.trabaja_actualmente ? null : nulo(e.fecha_retiro), trabaja_actualmente: !!e.trabaja_actualmente,
      motivo_retiro: nulo(e.motivo_retiro?.trim()), funciones: nulo(e.funciones?.trim()),
    })))
}

export async function guardarReferencias(candidatoId: string, lista: Referencia[]): Promise<string | null> {
  return reemplazar('candidato_referencias', candidatoId, lista
    .filter((r) => r.nombre?.trim())
    .map((r) => ({
      tipo: r.tipo, nombre: r.nombre.trim().toUpperCase(), parentesco: nulo(r.parentesco?.trim()), ocupacion: nulo(r.ocupacion?.trim()),
      telefono: nulo(r.telefono?.trim()), direccion: nulo(r.direccion?.trim()), empresa: nulo(r.empresa?.trim()),
    })))
}

export async function cargarHojaVida(candidatoId: string): Promise<{ estudios: Estudio[]; experiencias: Experiencia[]; referencias: Referencia[] }> {
  const sb = getSupabase()
  const [e, x, r] = await Promise.all([
    sb.from('candidato_estudios').select('nivel, institucion, titulo, ciudad, anio_finalizacion, ultimo_curso_aprobado, en_curso, intensidad_horaria').eq('candidato_id', candidatoId).order('orden'),
    sb.from('candidato_experiencias').select('empresa, cargo, telefono, direccion, jefe_inmediato, cargo_jefe, fecha_ingreso, fecha_retiro, trabaja_actualmente, motivo_retiro, funciones').eq('candidato_id', candidatoId).order('orden'),
    sb.from('candidato_referencias').select('tipo, nombre, parentesco, ocupacion, telefono, direccion, empresa').eq('candidato_id', candidatoId).order('orden'),
  ])
  return { estudios: (e.data as any) ?? [], experiencias: (x.data as any) ?? [], referencias: (r.data as any) ?? [] }
}

export interface ResultadoIdentificar {
  encontrado: boolean
  requiereSegundoFactor?: boolean
  candidato?: CandidatoForm
  error?: string
}

/**
 * Ruta B — identificación por documento. Como la RLS impide que un anónimo lea
 * candidatos de otros, la búsqueda + "reclamo" (reasignar auth_uid a esta sesión)
 * se hace en el servidor con service role, validando 2º factor (últimos 4 del doc).
 */
export async function identificarPorDocumento(
  tipo: TipoDoc, numero: string, ultimos4?: string
): Promise<ResultadoIdentificar> {
  const uid = await ensureAnonSession()
  const sb = getSupabase()
  const { data: s } = await sb.auth.getSession()
  const res = await fetch('/api/registro/identificar', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${s.session?.access_token ?? ''}`,
    },
    body: JSON.stringify({ tipo, numero, ultimos4, uid }),
  })
  return (await res.json()) as ResultadoIdentificar
}

/** Crea el candidato (tras identificación) con la sesión anónima como dueña. */
export async function crearCandidato(
  tipo: TipoDoc, numero: string, filtros: { antes?: boolean | null; trabajado?: boolean | null }
): Promise<{ id?: string; duplicado?: boolean; error?: string }> {
  const uid = await ensureAnonSession()
  const sb = getSupabase()
  const { data, error } = await sb
    .from('candidatos')
    .insert({
      auth_uid: uid,
      tipo_documento: tipo,
      numero_documento: numero.trim(),
      ha_hecho_proceso_antes: filtros.antes ?? null,
      ha_trabajado_antes: filtros.trabajado ?? null,
      estado: 'BORRADOR',
      paso_actual: 2,
    } as any)
    .select('id')
    .single()
  if (error) {
    // 23505 = unique_violation → ya existe un registro con ese documento.
    if ((error as any).code === '23505') return { duplicado: true }
    return { error: error.message }
  }
  return { id: (data as any).id }
}

/** Autosave: guarda un subconjunto de campos del candidato. */
export async function guardarCandidato(id: string, patch: Partial<CandidatoForm>): Promise<string | null> {
  const sb = getSupabase()
  const { error } = await sb.from('candidatos').update(patch as any).eq('id', id)
  return error ? error.message : null
}

export async function guardarDireccion(candidatoId: string, dir: DireccionForm): Promise<void> {
  const sb = getSupabase()
  // Cierra la dirección vigente anterior y crea la nueva (versionado).
  await sb
    .from('candidato_direcciones')
    .update({ vigente_hasta: new Date().toISOString().slice(0, 10) } as any)
    .eq('candidato_id', candidatoId)
    .is('vigente_hasta', null)
  await sb.from('candidato_direcciones').insert({
    candidato_id: candidatoId,
    direccion: dir.direccion,
    barrio: dir.barrio ?? null,
    departamento_codigo: dir.departamento_codigo ?? null,
    municipio_codigo: dir.municipio_codigo ?? null,
    localidad: dir.localidad ?? null,
    reportada_por: 'CANDIDATO',
  } as any)
}

export async function cargarDireccion(candidatoId: string): Promise<DireccionForm | null> {
  const sb = getSupabase()
  const { data } = await sb
    .from('candidato_direcciones')
    .select('direccion, barrio, departamento_codigo, municipio_codigo, localidad')
    .eq('candidato_id', candidatoId)
    .is('vigente_hasta', null)
    .order('vigente_desde', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as any) ?? null
}

export async function guardarBeneficiarios(candidatoId: string, lista: Beneficiario[]): Promise<void> {
  const sb = getSupabase()
  await sb.from('beneficiarios').delete().eq('candidato_id', candidatoId)
  if (lista.length === 0) return
  await sb.from('beneficiarios').insert(
    lista.map((b) => ({ ...b, candidato_id: candidatoId })) as any
  )
}

export async function cargarBeneficiarios(candidatoId: string): Promise<Beneficiario[]> {
  const sb = getSupabase()
  const { data } = await sb
    .from('beneficiarios')
    .select('nombres, apellidos, parentesco, tipo_documento, numero_documento, fecha_nacimiento')
    .eq('candidato_id', candidatoId)
  return (data as any) ?? []
}

export interface ConsentimientoInput {
  tipo: string
  otorgado: boolean
  texto_version: string
  texto_hash: string
}

export async function registrarConsentimientos(
  candidatoId: string, consentimientos: ConsentimientoInput[]
): Promise<void> {
  const sb = getSupabase()
  await sb.from('consentimientos').insert(
    consentimientos.map((c) => ({
      candidato_id: candidatoId,
      tipo: c.tipo,
      otorgado: c.otorgado,
      texto_version: c.texto_version,
      texto_hash: c.texto_hash,
      user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    })) as any
  )
}

export interface Credenciales { login_email: string; password: string }

/**
 * Convierte la sesión anónima en una cuenta permanente de la plataforma.
 * Devuelve las credenciales para mostrar al candidato, o un error.
 */
export async function crearCuentaAcceso(): Promise<{ credenciales?: Credenciales; yaExiste?: boolean; error?: string }> {
  await ensureAnonSession()
  const sb = getSupabase()
  const { data: s } = await sb.auth.getSession()
  const res = await fetch('/api/registro/crear-cuenta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token ?? ''}` },
  })
  const j = await res.json()
  if (!res.ok) return { yaExiste: j.yaExiste, error: j.error }
  return { credenciales: { login_email: j.login_email, password: j.password } }
}

/** Marca el candidato como POSTULADO (Paso 5). Crea la postulación. */
export async function enviarPostulacion(candidatoId: string, vacanteId?: string | null): Promise<string | null> {
  const sb = getSupabase()
  const e1 = await sb.from('candidatos').update({ estado: 'POSTULADO', paso_actual: 5 } as any).eq('id', candidatoId)
  if (e1.error) return e1.error.message
  const e2 = await sb.from('postulaciones').insert({
    candidato_id: candidatoId,
    vacante_id: vacanteId ?? null,
    estado: 'POSTULADO',
  } as any)
  return e2.error ? e2.error.message : null
}

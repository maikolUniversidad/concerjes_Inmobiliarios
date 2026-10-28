'use server'

// Escrituras de los activos del cliente, sus tipos, sus medidores, sus lecturas
// y su código QR (F6 del módulo de Puntos QR).
//
// Lo que va por server action + RLS y lo que no:
//   · tipos, activos, medidores y lecturas van por server action, porque no hay
//     máquina de estados que proteger y la política de la migración ya exige el
//     permiso MÁS el contrato en el alcance (`auth_grupos()`);
//   · el QR del activo también entra aquí, pero por un motivo distinto: el
//     token lo FIRMA el servidor con la llave HMAC (ADR-B), que nunca sale de
//     aquí ni llega al navegador. Cerrar una versión va por la RPC
//     `ronda_qr_revocar` de F2, que es donde vive la máquina de estados;
//   · los ARCHIVOS (documentos y fotos) NO pasan por aquí: se suben directo al
//     bucket desde el navegador, porque por una server action pasaría todo el
//     binario y el límite de cuerpo es de 4,5 MB (mismo patrón que
//     /rondas/instructivos).
//
// `grupo_id` y `sede_nombre` NO se mandan nunca desde aquí: los derivan los
// triggers `activos_derivar()` y `activo_medidores_derivar()` a partir de la
// sede. Es a propósito — `grupo_id` es la columna por la que filtra la RLS, y
// si la pantalla pudiera elegirla, un error de formulario metería el activo de
// un cliente en el contrato de otro.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import { armarToken, llaveActual, secretoDeLlave } from '@/lib/puntos-qr-firma'

export interface ActionResult { error?: string; ok?: boolean; id?: string }

const GESTIONA = 'gestionar_activos_ronda'
const LECTURAS = 'registrar_lecturas_activos'

function texto(fd: FormData, campo: string): string | null {
  const s = String(fd.get(campo) ?? '').trim()
  return s === '' ? null : s
}
function numero(fd: FormData, campo: string): number | null {
  const s = texto(fd, campo)
  if (s === null) return null
  const n = Number(s.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function entero(fd: FormData, campo: string, porDefecto: number): number {
  const n = numero(fd, campo)
  return n === null ? porDefecto : Math.round(n)
}
const marcado = (fd: FormData, campo: string) =>
  fd.get(campo) === 'on' || fd.get(campo) === 'true'

function traducir(msg: string): string {
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: esa sede o ese activo no están en tu alcance de contratos.'
  }
  if (msg.includes('ux_activos_codigo')) {
    return 'Ya hay otro activo con ese código en el mismo contrato.'
  }
  if (msg.includes('ux_activo_tipos_codigo')) {
    return 'Ya hay otro tipo de activo con ese código en ese ámbito.'
  }
  if (msg.includes('ux_activo_medidores_codigo')) {
    return 'Ese activo ya tiene un medidor con ese código.'
  }
  if (msg.includes('activo_tipos_codigo_chk')) {
    return 'El código del tipo va en MAYÚSCULAS, sin espacios ni tildes (por ejemplo PUERTA_AUTOMATICA).'
  }
  if (msg.includes('activo_medidores_codigo_chk')) {
    return 'El código del medidor va en MAYÚSCULAS, sin espacios ni tildes (por ejemplo PRINCIPAL).'
  }
  if (msg.includes('activo_tipos_medidor_chk')) {
    return 'Si el tipo exige medidor, hay que decir de qué clase es (horas, ciclos o lectura).'
  }
  if (msg.includes('zona no pertenece')) return 'La zona que elegiste es de otra sede.'
  if (msg.includes('punto de control no pertenece')) {
    return 'El punto de control que elegiste es de otra sede.'
  }
  if (msg.includes('tipo de activo es de otro contrato')) {
    return 'Ese tipo de activo es de otro contrato: usa uno general o uno de este contrato.'
  }
  if (msg.includes('padre es de otro contrato')) {
    return 'El activo padre es de otro contrato.'
  }
  if (msg.includes('descendiente de sí mismo') || msg.includes('ciclo')) {
    return 'Ese activo no puede ser su propio padre ni descendiente de sí mismo.'
  }
  if (msg.includes('activos_garantia_chk')) {
    return 'La garantía no puede vencer antes de la fecha de instalación.'
  }
  if (msg.includes('activo_lecturas_contador')) {
    return 'El medidor es acumulativo: la lectura no puede ser menor que la mayor ya registrada. Si el contador se reemplazó, crea un medidor nuevo.'
  }
  if (msg.includes('futuro')) return 'La fecha de la lectura está en el futuro.'
  if (msg.includes('inactivo')) return 'Ese medidor está inactivo: no admite lecturas nuevas.'
  if (msg.includes('ux_ronda_qr_unico_act')) {
    return 'Ese activo ya tiene un código QR activo. Hay que reemplazarlo, no emitir otro.'
  }
  if (msg.includes('ux_ronda_qr_version_act')) {
    return 'Alguien más acaba de emitir un código para ese activo. Recarga la pantalla.'
  }
  if (msg.includes('ux_ronda_qr_token') || msg.includes('ux_ronda_qr_manual')) {
    return 'El código generado choca con uno que ya existe. Inténtalo otra vez.'
  }
  if (msg.includes('violates foreign key') && msg.includes('activo_lecturas')) {
    return 'Ese medidor tiene lecturas registradas: no se puede borrar sin borrarlas antes.'
  }
  if (msg.includes('violates foreign key')) {
    return 'Hay otra cosa que depende de este registro, así que la base no deja borrarlo.'
  }
  if (msg.includes('permiso')) return msg
  return 'No se pudo guardar: ' + msg
}

async function cliente() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, user }
}

function refrescar(activoId?: string | null) {
  revalidatePath('/rondas/activos')
  if (activoId) revalidatePath(`/rondas/activos/${activoId}`)
}

// ──────────────────────────────────────────────────────────────────────────────
// Tipos de activo
// ──────────────────────────────────────────────────────────────────────────────

export async function guardarTipoActivo(
  _prev: ActionResult, fd: FormData,
): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const id = texto(fd, 'id')
  const codigo = texto(fd, 'codigo')
  const nombre = texto(fd, 'nombre')
  if (!codigo) return { error: 'El tipo necesita un código.' }
  if (!nombre) return { error: 'El tipo necesita un nombre.' }

  const exigeMedidor = marcado(fd, 'exige_medidor')
  const medidorTipo = texto(fd, 'medidor_tipo')
  if (exigeMedidor && !medidorTipo) {
    return { error: 'Si el tipo exige medidor, elige de qué clase es.' }
  }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const fila = {
    // `grupo_id` NULL = tipo general, que aplica a todos los contratos (§2.4).
    grupo_id: texto(fd, 'grupo_id'),
    codigo: codigo.toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    nombre,
    descripcion: texto(fd, 'descripcion'),
    categoria: texto(fd, 'categoria') ?? 'OTRO',
    icono: texto(fd, 'icono'),
    criticidad_sugerida: texto(fd, 'criticidad_sugerida') ?? 'MEDIA',
    vida_util_meses: numero(fd, 'vida_util_meses'),
    exige_medidor: exigeMedidor,
    medidor_tipo: exigeMedidor ? medidorTipo : null,
    medidor_unidad: exigeMedidor ? texto(fd, 'medidor_unidad') : null,
    obligatorio_normativo: marcado(fd, 'obligatorio_normativo'),
    normativa: texto(fd, 'normativa'),
    orden: entero(fd, 'orden', 0),
    activo: marcado(fd, 'activo'),
  }

  if (id) {
    const { error } = await sb.from('activo_tipos').update(fila).eq('id', id)
    if (error) return { error: traducir(error.message) }
    refrescar()
    return { ok: true, id }
  }
  const { data, error } = await sb.from('activo_tipos')
    .insert({ ...fila, created_by: user.id }).select('id').single()
  if (error) return { error: traducir(error.message) }
  refrescar()
  return { ok: true, id: data?.id }
}

export async function eliminarTipoActivo(id: string): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const { sb } = await cliente()
  const { error } = await sb.from('activo_tipos').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  refrescar()
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────────
// Activos
// ──────────────────────────────────────────────────────────────────────────────

export async function guardarActivo(
  _prev: ActionResult, fd: FormData,
): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const id = texto(fd, 'id')
  const sedeId = texto(fd, 'sede_id')
  const nombre = texto(fd, 'nombre')
  if (!sedeId) return { error: 'Elige la sede donde está el activo.' }
  if (!nombre) return { error: 'El activo necesita un nombre.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const fila = {
    sede_id: sedeId,
    zona_id: texto(fd, 'zona_id'),
    punto_id: texto(fd, 'punto_id'),
    activo_tipo_id: texto(fd, 'activo_tipo_id'),
    padre_id: texto(fd, 'padre_id'),
    // El código se puede dejar vacío: lo pone la secuencia en el trigger.
    codigo: texto(fd, 'codigo'),
    nombre,
    descripcion: texto(fd, 'descripcion'),
    marca: texto(fd, 'marca'),
    modelo: texto(fd, 'modelo'),
    serial: texto(fd, 'serial'),
    ubicacion_texto: texto(fd, 'ubicacion_texto'),
    piso: texto(fd, 'piso'),
    fecha_instalacion: texto(fd, 'fecha_instalacion'),
    garantia_hasta: texto(fd, 'garantia_hasta'),
    proveedor_id: texto(fd, 'proveedor_id'),
    criticidad: texto(fd, 'criticidad') ?? 'MEDIA',
    estado: texto(fd, 'estado') ?? 'OPERATIVO',
    observaciones: texto(fd, 'observaciones'),
    activo: marcado(fd, 'activo'),
  }

  if (id) {
    // El código sí se puede corregir, pero no borrar: un activo sin código no
    // se puede nombrar en una orden de trabajo.
    const parche = fila.codigo === null ? (({ codigo, ...r }) => r)(fila) : fila
    const { error } = await sb.from('activos').update(parche).eq('id', id)
    if (error) return { error: traducir(error.message) }
    refrescar(id)
    return { ok: true, id }
  }
  const { data, error } = await sb.from('activos')
    .insert({ ...fila, created_by: user.id }).select('id').single()
  if (error) return { error: traducir(error.message) }
  refrescar(data?.id)
  return { ok: true, id: data?.id }
}

export async function eliminarActivo(id: string): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const { sb } = await cliente()

  // Un activo con QR emitido no se borra: la placa ya existe en el mundo
  // físico. Se RETIRA, que es para lo que está el estado.
  const { count } = await sb.from('ronda_qr')
    .select('id', { count: 'exact', head: true }).eq('activo_id', id)
  if ((count ?? 0) > 0) {
    return {
      error: 'Ese activo ya tiene códigos QR emitidos: hay placas impresas. Déjalo en estado Retirado en vez de borrarlo.',
    }
  }
  const { error } = await sb.from('activos').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  refrescar()
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────────
// Medidores y lecturas
// ──────────────────────────────────────────────────────────────────────────────

export async function guardarMedidor(
  _prev: ActionResult, fd: FormData,
): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const id = texto(fd, 'id')
  const activoId = texto(fd, 'activo_id')
  const nombre = texto(fd, 'nombre')
  const tipo = texto(fd, 'tipo')
  if (!activoId) return { error: 'Medidor sin activo.' }
  if (!nombre) return { error: 'El medidor necesita un nombre.' }
  if (!tipo) return { error: 'Elige la clase de medidor.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  // `valor_actual` y `leido_at` NO se escriben aquí: son caché de la última
  // lectura y los recalcula el trigger `activo_lecturas_refrescar`.
  const fila = {
    activo_id: activoId,
    codigo: (texto(fd, 'codigo') ?? 'PRINCIPAL').toUpperCase().replace(/[^A-Z0-9_]/g, '_'),
    nombre,
    tipo,
    unidad: texto(fd, 'unidad') ?? 'h',
    acumulativo: marcado(fd, 'acumulativo'),
    decimales: entero(fd, 'decimales', 0),
    valor_alerta: numero(fd, 'valor_alerta'),
    activo: marcado(fd, 'activo'),
  }

  if (id) {
    const { error } = await sb.from('activo_medidores').update(fila).eq('id', id)
    if (error) return { error: traducir(error.message) }
    refrescar(activoId)
    return { ok: true, id }
  }
  const { data, error } = await sb.from('activo_medidores')
    .insert({ ...fila, created_by: user.id }).select('id').single()
  if (error) return { error: traducir(error.message) }
  refrescar(activoId)
  return { ok: true, id: data?.id }
}

export async function eliminarMedidor(id: string, activoId: string): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const { sb } = await cliente()
  const { error } = await sb.from('activo_medidores').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  refrescar(activoId)
  return { ok: true }
}

/** Registra una lectura. Va con `registrar_lecturas_activos`, no con
 *  `gestionar_activos_ronda`: el técnico que toma la lectura en sitio no tiene
 *  por qué poder editar la ficha del activo. */
export async function registrarLectura(
  _prev: ActionResult, fd: FormData,
): Promise<ActionResult> {
  const falta = await faltaPermiso(LECTURAS)
  if (falta) return { error: falta }

  const medidorId = texto(fd, 'medidor_id')
  const activoId = texto(fd, 'activo_id')
  const valor = numero(fd, 'valor')
  if (!medidorId) return { error: 'Lectura sin medidor.' }
  if (valor === null) return { error: 'Escribe el valor de la lectura.' }
  if (valor < 0) return { error: 'La lectura no puede ser negativa.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  // `activo_id`, `grupo_id`, `sede_id`, `valor_anterior` y `delta` los deriva el
  // trigger del medidor: aquí no se calculan para que no haya dos verdades.
  const leido = texto(fd, 'leido_at')
  const { error } = await sb.from('activo_lecturas').insert({
    medidor_id: medidorId,
    activo_id: activoId,
    grupo_id: null,
    sede_id: null,
    valor,
    leido_at: leido ? new Date(leido).toISOString() : new Date().toISOString(),
    usuario_id: user.id,
    origen: 'CONSOLA',
    nota: texto(fd, 'nota'),
  })
  if (error) return { error: traducir(error.message) }
  refrescar(activoId)
  return { ok: true }
}

/** Borra una lectura. No hay forma de EDITARLA (la RLS no concede UPDATE): una
 *  digitación mala se borra y se vuelve a tomar, y así el histórico no miente.
 *  Al borrar, el trigger recalcula `valor_actual` desde la lectura que quede. */
export async function eliminarLectura(id: string, activoId: string): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const { sb } = await cliente()
  const { error } = await sb.from('activo_lecturas').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  refrescar(activoId)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────────
// Documentos (la fila; el archivo lo sube el navegador)
// ──────────────────────────────────────────────────────────────────────────────

export async function guardarDocumentoActivo(
  _prev: ActionResult, fd: FormData,
): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }

  const activoId = texto(fd, 'activo_id')
  const path = texto(fd, 'archivo_path')
  const nombre = texto(fd, 'nombre')
  if (!activoId || !path) return { error: 'Falta el archivo.' }
  if (!nombre) return { error: 'El documento necesita un nombre.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { error } = await sb.from('activo_documentos').insert({
    activo_id: activoId,
    tipo: texto(fd, 'tipo') ?? 'OTRO',
    nombre,
    nombre_archivo: texto(fd, 'nombre_archivo'),
    archivo_path: path,
    mime: texto(fd, 'mime'),
    tamano: numero(fd, 'tamano'),
    vence_at: texto(fd, 'vence_at'),
    notas: texto(fd, 'notas'),
    subido_por: user.id,
  })
  if (error) return { error: traducir(error.message) }
  refrescar(activoId)
  return { ok: true }
}

export async function eliminarDocumentoActivo(
  id: string, activoId: string,
): Promise<ActionResult> {
  const falta = await faltaPermiso(GESTIONA)
  if (falta) return { error: falta }
  const { sb } = await cliente()
  // Primero la fila y después el archivo: si el borrado del archivo falla queda
  // un huérfano en el bucket, que es mucho menos grave que una fila apuntando a
  // un archivo que ya no existe.
  const { data: fila } = await sb.from('activo_documentos')
    .select('archivo_path').eq('id', id).maybeSingle()
  const { error } = await sb.from('activo_documentos').delete().eq('id', id)
  if (error) return { error: traducir(error.message) }
  if (fila?.archivo_path) {
    await sb.storage.from('rondas').remove([fila.archivo_path])
  }
  refrescar(activoId)
  return { ok: true }
}

// ──────────────────────────────────────────────────────────────────────────────
// El código QR del activo
// ──────────────────────────────────────────────────────────────────────────────
// Reutiliza el motor de F2 TAL CUAL: la misma tabla `ronda_qr`, la misma firma
// HMAC del ADR-B y la misma RPC de revocación. Lo único que cambia es sobre qué
// UUID se firma (el del activo) y qué columna lleva la referencia (`activo_id`).
//
// El permiso es `gestionar_qr_ronda`, el mismo del QR del punto: emitir un
// código es mandar a imprimir una placa, y da igual si va en una pared o en el
// costado de un ascensor.

const QR = 'gestionar_qr_ronda'

function llaveParaFirmar(): { id: string; secreto: string } | { error: string } {
  const id = llaveActual()
  if (!id) {
    return { error: 'Falta configurar RONDA_HMAC_LLAVE_ACTUAL en el servidor. Sin llave no se pueden emitir códigos.' }
  }
  const secreto = secretoDeLlave(id)
  if (!secreto) {
    return { error: `Falta el secreto de la llave "${id}" en el servidor. Avisa a soporte antes de mandar a imprimir.` }
  }
  return { id, secreto }
}

/** Emite la siguiente versión del QR de un activo. Si ya hay una ACTIVA, se
 *  revoca primero (con el motivo), que es lo que exige el índice único parcial
 *  `ux_ronda_qr_unico_act`: dos placas válidas en el mismo ascensor no se puede
 *  permitir ni con una carrera entre dos pestañas. */
export async function emitirQrActivo(
  _prev: ActionResult, fd: FormData,
): Promise<ActionResult> {
  const falta = await faltaPermiso(QR)
  if (falta) return { error: falta }
  const activoId = texto(fd, 'activo_id')
  if (!activoId) return { error: 'Activo no especificado.' }
  const motivo = texto(fd, 'motivo')

  const llave = llaveParaFirmar()
  if ('error' in llave) return { error: llave.error }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { data: activo, error: eActivo } = await sb.from('activos')
    .select('id, clave_publica, estado, codigo').eq('id', activoId).maybeSingle()
  if (eActivo) return { error: traducir(eActivo.message) }
  if (!activo) return { error: 'Ese activo no existe o no está en tu alcance.' }
  if (activo.estado === 'RETIRADO') {
    return { error: 'Ese activo está retirado: no se le emiten placas nuevas.' }
  }

  // Si hay una versión activa, se cierra por la RPC de F2, que es donde vive la
  // máquina de estados y la que libera el índice único parcial.
  const { data: vigente } = await sb.from('ronda_qr')
    .select('id').eq('activo_id', activoId).eq('estado', 'ACTIVO').maybeSingle()
  if (vigente?.id) {
    if (!motivo) {
      return { error: 'Ese activo ya tiene una placa activa: escribe por qué se reemplaza.' }
    }
    // REEMPLAZADO y no REVOCADO: la diferencia importa en la página pública,
    // que a una placa reemplazada le dice "busca la placa nueva en el mismo
    // lugar" y a una revocada no.
    const { error: eRev } = await sb.rpc('ronda_qr_revocar', {
      p_qr: vigente.id, p_motivo: motivo, p_estado: 'REEMPLAZADO',
    })
    if (eRev) return { error: traducir(eRev.message) }
  }

  // La versión la calcula el trigger si no se manda; se consulta para poder
  // firmar, porque la firma lleva la versión dentro.
  const { data: ultima } = await sb.from('ronda_qr')
    .select('version').eq('activo_id', activoId)
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version = Number(ultima?.version ?? 0) + 1
  if (version > 99) {
    return { error: 'Ese activo llegó a 99 versiones de placa. Avisa a soporte.' }
  }

  let token: string
  let firmaLlaveId: string
  try {
    const armado = armarToken({
      clavePublica: activo.clave_publica,
      // Se firma sobre el UUID del ACTIVO, igual que el del punto se firma
      // sobre el UUID del punto: así un token no se puede mover de objeto.
      puntoId: activo.id,
      version,
      llaveId: llave.id,
      secreto: llave.secreto,
    })
    token = armado.token
    firmaLlaveId = armado.firmaLlaveId
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo firmar el código.' }
  }

  const { error } = await sb.from('ronda_qr').insert({
    tipo_objeto: 'ACTIVO',
    activo_id: activoId,
    // `grupo_id` y `sede_id` los deriva el trigger del activo; van en nulo
    // porque la columna es NOT NULL y el trigger BEFORE corre antes del chequeo.
    grupo_id: null,
    sede_id: null,
    version,
    token,
    firma_llave_id: firmaLlaveId,
    estado: 'ACTIVO',
    reemplaza_a: vigente?.id ?? null,
    motivo_cambio: motivo,
    instalado_canal: 'CONSOLA',
    instalado_at: new Date().toISOString(),
    created_by: user.id,
  })
  if (error) return { error: traducir(error.message) }
  refrescar(activoId)
  return { ok: true }
}

/** Deja constancia de que la placa del activo se mandó a imprimir. Armar el PDF
 *  no cuenta como imprimir: esto se llama al confirmar, y es lo que suma el
 *  contador y deja el evento con el formato (misma RPC de F2). */
export async function registrarImpresionActivo(
  qrId: string, formato: string, activoId: string,
): Promise<ActionResult> {
  const falta = await faltaPermiso(QR)
  if (falta) return { error: falta }
  const { sb } = await cliente()
  const { error } = await sb.rpc('ronda_qr_registrar_impresion', {
    p_qr: qrId, p_formato: formato, p_lote: null,
  })
  if (error) return { error: traducir(error.message) }
  refrescar(activoId)
  return { ok: true }
}

/** Revoca la placa activa de un activo sin emitir otra (se cayó, se dañó, el
 *  activo salió de la operación). */
export async function revocarQrActivo(
  qrId: string, activoId: string, motivo: string,
): Promise<ActionResult> {
  const falta = await faltaPermiso(QR)
  if (falta) return { error: falta }
  if (!motivo.trim()) return { error: 'Escribe por qué se revoca la placa.' }
  const { sb } = await cliente()
  const { error } = await sb.rpc('ronda_qr_revocar', { p_qr: qrId, p_motivo: motivo.trim() })
  if (error) return { error: traducir(error.message) }
  refrescar(activoId)
  return { ok: true }
}

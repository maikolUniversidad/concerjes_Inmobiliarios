'use server'

// Emisión, reemplazo, revocación e impresión de códigos QR (F2).
//
// Esto NO es un CRUD: emitir un código es lo que manda a imprimir una placa que
// alguien va a ir a pegar a una pared, y revocarla obliga a volver. Por eso:
//   · el token lo firma el SERVIDOR con la llave HMAC del cliente (ADR-B), que
//     nunca sale de aquí ni llega al navegador;
//   · cerrar una versión va por la RPC `ronda_qr_revocar`, que es donde vive la
//     máquina de estados y la que libera el índice único parcial para que nazca
//     la siguiente versión;
//   · cada impresión va por `ronda_qr_registrar_impresion`, que suma al
//     contador y deja el evento con el formato y el lote.

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { faltaPermiso } from '@/lib/permisos-server'
import { FORMATOS_LOTE, type FormatoLote } from '@/lib/puntos-qr'
import { armarToken, llaveActual, secretoDeLlave } from '@/lib/puntos-qr-firma'

export interface ActionResult { error?: string; ok?: boolean }
export interface LoteResult extends ActionResult { loteId?: string; numero?: string }

const PERMISO = 'gestionar_qr_ronda'

function traducir(msg: string): string {
  if (msg.includes('ux_ronda_qr_activo')) {
    return 'Ese punto ya tiene un código QR activo. Hay que reemplazarlo, no emitir otro.'
  }
  if (msg.includes('ux_ronda_qr_version')) {
    return 'Alguien más acaba de emitir un código para ese punto. Recarga la pantalla.'
  }
  if (msg.includes('ux_ronda_qr_token') || msg.includes('ux_ronda_qr_manual')) {
    return 'El código generado choca con uno que ya existe. Inténtalo otra vez.'
  }
  if (msg.includes('row-level security')) {
    return 'La base de datos rechazó el cambio: ese punto no está en tu alcance de contratos.'
  }
  if (msg.includes('permiso')) return msg
  return 'No se pudo completar: ' + msg
}

async function cliente() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { sb: supabase as any, user }
}

function refrescar() {
  revalidatePath('/rondas/qr')
  revalidatePath('/rondas/puntos')
}

/** La llave con la que se firma hoy, y su secreto. Sin ella NO se emite nada:
 *  un token sin firma verificable es una placa que nunca va a abrir. */
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

/**
 * Emite la PRIMERA versión del QR de un punto que todavía no tiene ninguna
 * activa. Si el punto ya tiene una, no se emite otra: hay que reemplazarla
 * (`reemplazarQr`), porque dos placas válidas en la misma pared es exactamente
 * lo que el índice `ux_ronda_qr_activo` existe para impedir.
 */
export async function emitirQr(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const puntoId = String(fd.get('punto_id') ?? '')
  if (!puntoId) return { error: 'Punto no especificado.' }

  const llave = llaveParaFirmar()
  if ('error' in llave) return { error: llave.error }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { data: punto, error: ePunto } = await sb.from('ronda_puntos')
    .select('id, clave_publica, estado').eq('id', puntoId).maybeSingle()
  if (ePunto) return { error: traducir(ePunto.message) }
  if (!punto) return { error: 'Ese punto no existe o no está en tu alcance.' }
  if (punto.estado === 'RETIRADO') {
    return { error: 'El punto está retirado: no tiene sentido emitirle un código.' }
  }

  const { data: version, error: eVer } = await sb.rpc('ronda_qr_siguiente_version', { p_punto: puntoId })
  if (eVer) return { error: traducir(eVer.message) }

  let token: string
  let firmaLlaveId: string
  try {
    const armado = armarToken({
      clavePublica: punto.clave_publica,
      puntoId: punto.id,
      version: Number(version),
      llaveId: llave.id,
      secreto: llave.secreto,
    })
    token = armado.token
    firmaLlaveId = armado.firmaLlaveId
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo firmar el código.' }
  }

  const { error } = await sb.from('ronda_qr').insert({
    tipo_objeto: 'PUNTO',
    punto_id: punto.id,
    // `version`, `codigo_manual`, `grupo_id` y `sede_id` los pone el trigger.
    token,
    firma_llave_id: firmaLlaveId,
    estado: 'ACTIVO',
    instalado_canal: 'CONSOLA',
    created_by: user.id,
  })
  if (error) return { error: traducir(error.message) }

  refrescar()
  return { ok: true }
}

/**
 * Reemplaza la versión activa: cierra la anterior como REEMPLAZADO y emite la
 * siguiente. Son dos pasos y el orden importa — mientras la anterior siga
 * ACTIVA, el índice único no deja nacer la nueva.
 *
 * Si el segundo paso falla, la anterior queda REEMPLAZADA y el punto sin código
 * activo. Es el resultado correcto y no se "deshace": la placa vieja ya se dio
 * por mala, y dejarla válida sería peor que dejar el punto sin código un rato.
 * La pantalla lo dice y basta con volver a emitir.
 */
export async function reemplazarQr(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const qrId = String(fd.get('qr_id') ?? '')
  const puntoId = String(fd.get('punto_id') ?? '')
  const motivo = String(fd.get('motivo') ?? '').trim() || null
  if (!qrId || !puntoId) return { error: 'Código no especificado.' }

  const llave = llaveParaFirmar()
  if ('error' in llave) return { error: llave.error }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { error: eRev } = await sb.rpc('ronda_qr_revocar', {
    p_qr: qrId, p_motivo: motivo, p_estado: 'REEMPLAZADO',
  })
  if (eRev) return { error: traducir(eRev.message) }

  const { data: punto, error: ePunto } = await sb.from('ronda_puntos')
    .select('id, clave_publica').eq('id', puntoId).maybeSingle()
  if (ePunto || !punto) {
    return { error: 'La placa anterior quedó reemplazada, pero no se pudo leer el punto para emitir la nueva. Vuelve a emitir.' }
  }
  const { data: version, error: eVer } = await sb.rpc('ronda_qr_siguiente_version', { p_punto: puntoId })
  if (eVer) {
    return { error: 'La placa anterior quedó reemplazada, pero no se pudo calcular la versión nueva. Vuelve a emitir.' }
  }

  const armado = armarToken({
    clavePublica: punto.clave_publica,
    puntoId: punto.id,
    version: Number(version),
    llaveId: llave.id,
    secreto: llave.secreto,
  })

  const { error } = await sb.from('ronda_qr').insert({
    tipo_objeto: 'PUNTO',
    punto_id: punto.id,
    token: armado.token,
    firma_llave_id: armado.firmaLlaveId,
    estado: 'ACTIVO',
    reemplaza_a: qrId,
    motivo_cambio: motivo,
    instalado_canal: 'CONSOLA',
    created_by: user.id,
  })
  if (error) {
    return { error: `La placa anterior quedó reemplazada, pero la nueva no se creó: ${traducir(error.message)}` }
  }

  refrescar()
  return { ok: true }
}

/** Revoca sin emitir reemplazo: la placa deja de abrir y el punto queda sin
 *  código. Es lo que se hace cuando se retira un punto o se sospecha de una
 *  placa fabricada. */
export async function revocarQr(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }
  const qrId = String(fd.get('qr_id') ?? '')
  const motivo = String(fd.get('motivo') ?? '').trim() || null
  if (!qrId) return { error: 'Código no especificado.' }

  const { sb } = await cliente()
  const { error } = await sb.rpc('ronda_qr_revocar', {
    p_qr: qrId, p_motivo: motivo, p_estado: 'REVOCADO',
  })
  if (error) return { error: traducir(error.message) }
  refrescar()
  return { ok: true }
}

/**
 * Crea el lote de impresión y registra una impresión por cada QR que entra en
 * él. Se llama al CONFIRMAR la impresión, no al abrir la vista previa: mirar un
 * PDF no es imprimir, y un contador que sube por mirarlo no sirve para saber
 * cuántas placas hay dando vueltas.
 */
export async function registrarLote(_prev: LoteResult, fd: FormData): Promise<LoteResult> {
  const falta = await faltaPermiso(PERMISO)
  if (falta) return { error: falta }

  const sedeId = String(fd.get('sede_id') ?? '')
  const formato = String(fd.get('formato') ?? '') as FormatoLote
  const nombre = String(fd.get('nombre') ?? '').trim() || null
  const qrIds = String(fd.get('qr_ids') ?? '').split(',').map((s) => s.trim()).filter(Boolean)

  if (!sedeId) return { error: 'Lote sin sede.' }
  if (!FORMATOS_LOTE.includes(formato)) return { error: 'Formato de impresión no válido.' }
  if (qrIds.length === 0) return { error: 'No hay ningún código en el lote.' }

  const { sb, user } = await cliente()
  if (!user) return { error: 'Debes iniciar sesión.' }

  const { data: lote, error: eLote } = await sb.from('ronda_qr_lotes').insert({
    // `numero` lo pone la secuencia `ronda_lote_seq` (LQ-000001): nunca se
    // calcula aquí, porque dos personas imprimiendo a la vez colisionarían.
    // `grupo_id` lo deriva de la sede el trigger `ronda_qr_lotes_derivar()`, y
    // es contra esa columna derivada que la RLS verifica el alcance.
    sede_id: sedeId,
    nombre,
    formato,
    cantidad: qrIds.length,
    generado_por: user.id,
  }).select('id, numero').single()
  if (eLote) return { error: traducir(eLote.message) }

  // Una llamada por código: la RPC verifica el permiso y el alcance de cada uno
  // y deja su propio evento. Si alguna falla, se informa y el lote queda con las
  // que sí entraron, que es lo que de verdad se imprimió.
  const fallidas: string[] = []
  for (const qrId of qrIds) {
    const { error } = await sb.rpc('ronda_qr_registrar_impresion', {
      p_qr: qrId, p_formato: formato, p_lote: lote.id,
    })
    if (error) fallidas.push(qrId)
  }

  refrescar()
  if (fallidas.length) {
    return {
      loteId: lote.id, numero: lote.numero,
      error: `El lote ${lote.numero} quedó creado, pero ${fallidas.length} de ${qrIds.length} códigos no se pudieron registrar.`,
    }
  }
  return { ok: true, loteId: lote.id, numero: lote.numero }
}

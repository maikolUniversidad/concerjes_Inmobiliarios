// Decisión de /q/<token>: qué se abre, qué se rechaza y con qué motivo (F2 del
// módulo de Puntos QR). Es la puerta del módulo: todo lo que entra por una placa
// pegada a una pared pasa por aquí.
//
// Por qué esta decisión vive aparte de la consulta: el orden de las
// comprobaciones es lo único que impide que un atacante aprenda cosas sondeando
// la ruta, y es lo que hay que poder probar. El acceso a datos entra por
// `PuertaDatos` (ver ./puerta-supabase.ts para la de verdad), así que
// `scripts/probar-puntos-qr-f2.mjs` prueba ESTE código contra la base real
// dentro de su transacción, sin montar Next.
//
// Las importaciones son relativas y no con `@/`: así este archivo se puede
// importar tal cual desde el script de pruebas, que no resuelve el alias.
//
// Reglas, en este orden — y el orden importa:
//   1. forma del código (token de 21 caracteres o código manual de 8);
//   2. existencia;
//   3. FIRMA (solo para el token: el código manual no la lleva);
//   4. estado del QR (activo / revocado / reemplazado / borrador);
//   5. vigencia del contrato (ronda_qr_vigente, §2.5 del complemento 2);
//   6. estado del punto.
// Si algo falla, no se abre nada y queda un evento en `ronda_eventos` con el
// motivo. Ese registro es la señal de fraude más barata que tiene el módulo y
// hoy no existe en ningún otro lado.

import {
  esCodigoManual, esToken, normalizar, partirToken, type EstadoPunto, type EstadoQr,
} from '../../lib/puntos-qr'
import { llaveActual, secretoDeLlave, verificarFirma } from '../../lib/puntos-qr-firma'

export type MotivoRechazo =
  | 'FORMA_INVALIDA'
  | 'NO_EXISTE'
  | 'FIRMA_INVALIDA'
  | 'SIN_LLAVE'
  | 'QR_REVOCADO'
  | 'QR_BORRADOR'
  | 'CONTRATO_NO_VIGENTE'
  | 'PUNTO_RETIRADO'

export const TEXTO_RECHAZO: Record<MotivoRechazo, { titulo: string; detalle: string }> = {
  FORMA_INVALIDA: {
    titulo: 'Este código no es válido',
    detalle: 'El código no tiene la forma de un punto de control. Revisa que lo hayas escrito completo, sin confundir letras parecidas.',
  },
  NO_EXISTE: {
    titulo: 'Este código no existe',
    detalle: 'No hay ningún punto de control con este código. Si lo escribiste a mano, vuelve a intentarlo; si lo escaneaste, avisa a tu supervisor.',
  },
  FIRMA_INVALIDA: {
    titulo: 'Este código no es auténtico',
    detalle: 'La firma del código no corresponde. Avisa a tu supervisor: puede ser una placa fabricada o alterada.',
  },
  SIN_LLAVE: {
    titulo: 'No se puede verificar el código',
    detalle: 'Falta configurar en el servidor la llave con la que se firmó esta placa. Avisa a soporte.',
  },
  QR_REVOCADO: {
    titulo: 'Esta placa ya no está en uso',
    detalle: 'El código de esta placa fue reemplazado. Busca la placa nueva en el mismo lugar y avisa a tu supervisor si no la encuentras.',
  },
  QR_BORRADOR: {
    titulo: 'Esta placa todavía no está activa',
    detalle: 'El código existe pero no se ha activado. Avisa a tu supervisor.',
  },
  CONTRATO_NO_VIGENTE: {
    titulo: 'El contrato de esta sede no está vigente',
    detalle: 'Mientras el contrato no esté vigente, los puntos de esta sede no se pueden usar. Avisa a tu supervisor.',
  },
  PUNTO_RETIRADO: {
    titulo: 'Este punto de control está retirado',
    detalle: 'El punto ya no hace parte de la operación. Avisa a tu supervisor.',
  },
}

export interface FilaQr {
  id: string
  punto_id: string | null
  grupo_id: string
  sede_id: string
  version: number
  estado: EstadoQr
  firma_llave_id: string
  codigo_manual: string
}

export interface FilaPunto {
  id: string
  codigo: string
  nombre: string
  descripcion: string | null
  piso: string | null
  estado: EstadoPunto
  exige_geocerca: boolean
  geocerca_metros: number
  zona_nombre: string | null
  sede_nombre: string
  sede_ciudad: string | null
  sede_direccion: string | null
}

export interface EventoAuditoria {
  grupo_id: string | null
  sede_id: string | null
  entidad: string
  entidad_id: string | null
  accion: string
  actor_tipo: string
  canal: string
  detalle: Record<string, unknown>
  ip: string | null
}

/** Todo el acceso a datos que necesita la decisión. La implementación de verdad
 *  está en ./puerta-supabase.ts; el script de pruebas pasa una sobre `pg`. */
export interface PuertaDatos {
  buscarQr(porToken: boolean, codigo: string): Promise<FilaQr | null>
  qrVigente(qrId: string): Promise<boolean>
  buscarPunto(puntoId: string): Promise<FilaPunto | null>
  registrarEvento(e: EventoAuditoria): Promise<void>
}

export interface PuntoResuelto {
  ok: true
  /** Cómo se abrió: escaneando el QR o tecleando el código impreso. La manual
   *  pesa menos en el puntaje del antifraude (ADR-B), y por eso se registra. */
  aperturaModo: 'QR' | 'MANUAL'
  qrId: string
  version: number
  codigoManual: string
  punto: {
    id: string
    codigo: string
    nombre: string
    descripcion: string | null
    piso: string | null
    zona: string | null
    sedeNombre: string
    sedeCiudad: string | null
    sedeDireccion: string | null
    exigeGeocerca: boolean
    geocercaMetros: number
  }
}

export interface PuntoRechazado {
  ok: false
  motivo: MotivoRechazo
}

export type Resolucion = PuntoResuelto | PuntoRechazado

/**
 * Resuelve lo que venga en /q/<codigo>.
 *
 * `codigo` es el token firmado de 21 caracteres o el código manual de 8. Se
 * normaliza (mayúsculas, sin guiones) pero NO se "corrige": si alguien escribe
 * una O donde va un 0, el código es otro y tiene que fallar, no abrir el punto
 * de al lado.
 */
export async function resolverCodigo(
  codigo: string, ip: string | null, puerta: PuertaDatos,
): Promise<Resolucion> {
  const c = normalizar(codigo)
  const esQr = esToken(c)
  const esManual = !esQr && esCodigoManual(c)

  const evento = async (
    accion: string, qr: FilaQr | null, detalle: Record<string, unknown>,
  ) => {
    // Que falle la auditoría no puede impedir que la página responda, pero
    // tampoco se calla: queda en el log del servidor.
    try {
      await puerta.registrarEvento({
        grupo_id: qr?.grupo_id ?? null,
        sede_id: qr?.sede_id ?? null,
        entidad: 'ronda_qr',
        entidad_id: qr?.id ?? null,
        accion,
        actor_tipo: 'ANONIMO',
        canal: 'PUBLICO',
        detalle,
        ip,
      })
    } catch (e) {
      console.error('[q] no se pudo registrar el evento de auditoría', e)
    }
  }

  if (!esQr && !esManual) {
    // De un intento con forma inválida no se guarda el código completo: sería
    // guardar basura de tamaño arbitrario. El prefijo basta para reconocer un
    // patrón de sondeo.
    await evento('APERTURA_RECHAZADA', null,
      { motivo: 'FORMA_INVALIDA', prefijo: c.slice(0, 12), largo: c.length })
    return { ok: false, motivo: 'FORMA_INVALIDA' }
  }

  const qr = await puerta.buscarQr(esQr, c)
  if (!qr) {
    await evento('APERTURA_RECHAZADA', null,
      { motivo: 'NO_EXISTE', modo: esQr ? 'QR' : 'MANUAL', codigo: c })
    return { ok: false, motivo: 'NO_EXISTE' }
  }

  const modo: 'QR' | 'MANUAL' = esQr ? 'QR' : 'MANUAL'
  const rechazar = async (motivo: MotivoRechazo, extra: Record<string, unknown> = {}) => {
    await evento('APERTURA_RECHAZADA', qr, { motivo, modo, version: qr.version, ...extra })
    return { ok: false as const, motivo }
  }

  // ── La firma ────────────────────────────────────────────────────────────────
  // Solo el token la lleva. El código manual no puede llevarla: ocho caracteres
  // no dan para un HMAC, y por eso vale menos — abre el mismo flujo, pero queda
  // marcado como apertura manual para que el antifraude lo pese distinto.
  if (esQr) {
    const partes = partirToken(c)!
    const secreto = secretoDeLlave(qr.firma_llave_id)
    if (!secreto) {
      return rechazar('SIN_LLAVE', { llave: qr.firma_llave_id, llave_actual: llaveActual() })
    }
    // La versión del token tiene que ser la de ESTA fila: si no, alguien pegó
    // la firma de una versión en el cuerpo de otra.
    if (partes.version !== Number(qr.version)) {
      return rechazar('FIRMA_INVALIDA', { detalle: 'version_cruzada' })
    }
    if (!qr.punto_id || !verificarFirma(c, qr.punto_id, partes.version, secreto)) {
      return rechazar('FIRMA_INVALIDA', { llave: qr.firma_llave_id })
    }
  }

  if (qr.estado === 'REVOCADO' || qr.estado === 'REEMPLAZADO') {
    return rechazar('QR_REVOCADO', { estado: qr.estado })
  }
  if (qr.estado !== 'ACTIVO') {
    return rechazar('QR_BORRADOR', { estado: qr.estado })
  }

  // ── La vigencia del contrato ────────────────────────────────────────────────
  // Se le pregunta a la base, que es la fuente de verdad: `ronda_qr_vigente()`
  // es `estado = 'ACTIVO' AND grupo_vigente(contrato)`. Al renovar el contrato
  // el QR vuelve a servir sin que nadie toque una fila (§2.5).
  if (!(await puerta.qrVigente(qr.id))) return rechazar('CONTRATO_NO_VIGENTE')

  if (!qr.punto_id) return rechazar('NO_EXISTE', { detalle: 'qr_sin_punto' })
  const punto = await puerta.buscarPunto(qr.punto_id)
  if (!punto) return rechazar('NO_EXISTE', { detalle: 'punto_borrado' })
  if (punto.estado === 'RETIRADO') return rechazar('PUNTO_RETIRADO')

  await evento('APERTURA', qr, { modo, version: qr.version, punto: punto.codigo })

  return {
    ok: true,
    aperturaModo: modo,
    qrId: qr.id,
    version: Number(qr.version),
    codigoManual: qr.codigo_manual,
    punto: {
      id: punto.id,
      codigo: punto.codigo,
      nombre: punto.nombre,
      descripcion: punto.descripcion,
      piso: punto.piso,
      zona: punto.zona_nombre,
      sedeNombre: punto.sede_nombre,
      sedeCiudad: punto.sede_ciudad,
      sedeDireccion: punto.sede_direccion,
      exigeGeocerca: punto.exige_geocerca,
      geocercaMetros: Number(punto.geocerca_metros),
    },
  }
}

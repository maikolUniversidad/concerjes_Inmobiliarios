import 'server-only'

// El trabajador del buzón de salida.
//
// Es el mismo molde de `procesarCorreoSaliente` + /api/cron/correo, que ya
// funciona en este repositorio: filas PENDIENTE, un lote, intentos, error,
// presupuesto de tiempo. Lo que le agrega WhatsApp y un correo no necesita:
//
//   · CONTROL DE CAUDAL. El número en coexistencia tiene un tope FIJO de 20
//     mensajes por segundo y no se puede subir. Se trabaja a 15 para dejar
//     margen. Pasarse devuelve 130429, que no es un fallo del mensaje: es el
//     ritmo, y se reencola en segundos sin gastar intento.
//   · PRIMERO LAS RESPUESTAS. La cola ordena por prioridad: quien está parado
//     en un punto esperando una respuesta va antes que un aviso masivo. En un
//     envío a 800 personas alguien tiene que esperar, y no puede ser el
//     conserje.
//   · EL PORTERO OTRA VEZ. `whatsapp_salida_tomar` vuelve a evaluar ventana,
//     jornada, consentimiento y plantilla antes de entregar la fila: un mensaje
//     programado para las 19:55 que sale a las 20:05 ya está fuera de jornada.
//
// PRESUPUESTO DE TIEMPO, no de cantidad: se sale ordenadamente a los 50 s
// (sobre `maxDuration = 60`) dejando lo pendiente en la cola. Lo que quede lo
// recoge la próxima vuelta del cron. Nada se procesa dos veces.

import { cabenEn, caudalDe, intervaloMs } from './caudal'
import { clienteDe, SinCredencial, type ClienteWhatsapp, type CuentaTransporte } from './cliente'
import { config, simuladorActivo } from './config'
import type { MensajeSaliente } from './mensajes'

export interface ResultadoSalida {
  enviados: number
  simulados: number
  fallidos: number
  omitidos: number
  sinCredencial: number
  /** Quedó trabajo en la cola porque se agotó el presupuesto de tiempo. */
  incompleto: boolean
  cuentas: number
}

interface FilaSalida {
  id: string
  conversacion_id: string
  cuenta_id: string
  tipo: string
  texto: string | null
  payload: Record<string, unknown>
  es_plantilla: boolean
  plantilla_nombre: string | null
  plantilla_variables: unknown
  intentos: number
  prioridad: number
  programado_para: string | null
  created_at: string
}

/** Reconstruye el mensaje a partir de la fila. El `payload` que guardó la
 *  máquina ES el mensaje: así lo que se manda es exactamente lo que se encoló,
 *  sin volver a armarlo (y sin poder armarlo distinto). */
function mensajeDe(fila: FilaSalida, idioma = 'es_CO'): MensajeSaliente | null {
  const p = fila.payload ?? {}
  if (fila.es_plantilla && fila.plantilla_nombre) {
    const vars = Array.isArray(fila.plantilla_variables)
      ? (fila.plantilla_variables as unknown[]).map((v) => String(v))
      : []
    return {
      tipo: 'PLANTILLA',
      nombre: fila.plantilla_nombre,
      idioma,
      variables: vars,
      variablesEncabezado: Array.isArray((p as Record<string, unknown>).encabezado)
        ? ((p as Record<string, unknown>).encabezado as unknown[]).map((v) => String(v))
        : undefined,
    }
  }
  // El payload guardado ya tiene la forma de `MensajeSaliente`.
  if (typeof (p as { tipo?: unknown }).tipo === 'string') return p as unknown as MensajeSaliente
  // Respaldo: una fila vieja o escrita a mano con solo texto.
  if (fila.texto) return { tipo: 'TEXTO', texto: fila.texto }
  return null
}

/**
 * Procesa el buzón de salida.
 *
 * `presupuestoSeg` es el tiempo que se permite gastar; al agotarlo sale
 * ordenadamente. `supabase` tiene que ser el cliente de SERVICIO: las funciones
 * que reclaman el lote son SECURITY DEFINER y no se conceden a `authenticated`.
 */
export async function procesarSalida(
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  supabase: any,
  presupuestoSeg = 50,
  opciones: { cuentaId?: string; limite?: number } = {},
): Promise<ResultadoSalida> {
  const c = config()
  const hasta = Date.now() + presupuestoSeg * 1000
  const res: ResultadoSalida = {
    enviados: 0,
    simulados: 0,
    fallidos: 0,
    omitidos: 0,
    sinCredencial: 0,
    incompleto: false,
    cuentas: 0,
  }

  const { data: cuentas } = await supabase
    .from('whatsapp_cuentas')
    .select('id, alias, transporte, estado, phone_number_id, api_version, throughput_mps')
    .in('estado', ['ACTIVA', 'SIMULADA'])
    .order('predeterminada', { ascending: false })

  const lista = (cuentas ?? []) as (CuentaTransporte & { throughput_mps: number })[]
  res.cuentas = lista.length
  if (!lista.length) return res

  for (const cuenta of lista) {
    if (opciones.cuentaId && cuenta.id !== opciones.cuentaId) continue
    if (Date.now() >= hasta) {
      res.incompleto = true
      break
    }

    let cliente: ClienteWhatsapp
    try {
      cliente = await clienteDe(cuenta, supabase, simuladorActivo())
    } catch (e) {
      if (e instanceof SinCredencial) {
        // La cola se DETIENE para esta cuenta y no se descarta nada: los
        // mensajes quedan donde están y en la consola sale el aviso de
        // reconectar. Perder un mensaje por falta de token sería perder una
        // instrucción de trabajo.
        res.sinCredencial++
        await supabase
          .from('whatsapp_cuentas')
          .update({ estado: 'SUSPENDIDA', suspension_motivo: e.message })
          .eq('id', cuenta.id)
          .eq('estado', 'ACTIVA')
        continue
      }
      throw e
    }

    // El caudal propio, por debajo del del número. `throughput_mps` de la
    // cuenta es el tope real que informó Meta; el de la configuración es el
    // nuestro, y manda el menor de los dos. El cálculo vive en `caudal.ts`
    // porque el envío masivo de F10 reparte la hora de sus destinos con EL
    // MISMO número: si cada uno tuviera el suyo, un día quedarían desalineados.
    const mps = caudalDe(cuenta.throughput_mps)
    const paso = intervaloMs(mps)
    // Nunca se pide más de lo que cabe en el presupuesto al caudal permitido:
    // reclamar 500 filas para mandar 40 dejaría 460 EN_PROCESO esperando el
    // rescate de huérfanos.
    const limite = Math.min(opciones.limite ?? 200, cabenEn(hasta - Date.now(), mps))

    const { data: lote, error } = await supabase.rpc('whatsapp_salida_tomar', {
      p_cuenta: cuenta.id,
      p_limite: limite,
      p_jornada_desde: c.jornadaDesde,
      p_jornada_hasta: c.jornadaHasta,
      p_margen_horas: c.ventanaSeguridadHoras,
      p_zona: c.zonaHoraria,
    })
    if (error) throw new Error(`No se pudo reclamar el lote de salida: ${error.message}`)

    // El lote se ORDENA aquí, y no se confía en el orden en que vino: el
    // `RETURNING` de un UPDATE no garantiza el orden del ORDER BY con el que se
    // eligieron las filas. Y el orden importa: con el caudal fijo en 20 msj/s,
    // en un envío a 800 personas alguien tiene que esperar, y no puede ser el
    // conserje que está parado en un punto esperando una respuesta.
    const filas = ((lote ?? []) as FilaSalida[]).slice().sort((a, b) => {
      const p = (a.prioridad ?? 5) - (b.prioridad ?? 5)
      if (p !== 0) return p
      const ta = Date.parse(a.programado_para ?? a.created_at ?? '') || 0
      const tb = Date.parse(b.programado_para ?? b.created_at ?? '') || 0
      return ta - tb
    })
    if (!filas.length) continue

    // A quién se le manda: el `wa_id` de cada conversación.
    const ids = [...new Set(filas.map((f) => f.conversacion_id))]
    const { data: convs } = await supabase
      .from('crm_conversaciones')
      .select('id, wa_id')
      .in('id', ids)
    const destinos = new Map<string, string>(
      ((convs ?? []) as { id: string; wa_id: string }[]).map((x) => [x.id, x.wa_id]),
    )

    let ultimo = 0
    for (const fila of filas) {
      if (Date.now() >= hasta) {
        // Se devuelve a la cola lo que no se alcanzó: no se deja EN_PROCESO
        // esperando los 5 minutos del rescate de huérfanos.
        await supabase
          .from('crm_mensajes')
          .update({ estado: 'PENDIENTE', tomado_at: null })
          .eq('id', fila.id)
          .eq('estado', 'EN_PROCESO')
        res.incompleto = true
        continue
      }

      // Control de caudal: se espera lo que falte para no pasarse de mps.
      const espera = paso - (Date.now() - ultimo)
      if (espera > 0) await new Promise((r) => setTimeout(r, espera))
      ultimo = Date.now()

      const destino = destinos.get(fila.conversacion_id)
      if (!destino) {
        await supabase.rpc('whatsapp_salida_fallido', {
          p_mensaje: fila.id,
          p_codigo: 'SIN_DESTINO',
          p_error: 'La conversación no tiene wa_id.',
        })
        res.fallidos++
        continue
      }

      const mensaje = mensajeDe(fila)
      if (!mensaje) {
        await supabase.rpc('whatsapp_salida_fallido', {
          p_mensaje: fila.id,
          p_codigo: 'SIN_CUERPO',
          p_error: 'El mensaje encolado no tiene contenido que mandar.',
        })
        res.fallidos++
        continue
      }

      const r = await cliente.enviar(destino, mensaje)
      if (r.ok) {
        await supabase.rpc('whatsapp_salida_enviado', {
          p_mensaje: fila.id,
          p_wamid: r.wamid,
          p_estado: r.simulado ? 'SIMULADO' : 'ENVIADO',
        })
        // El payload que SALIÓ se guarda: es la prueba de qué se mandó, con los
        // mismos bytes, y es lo que el simulador pinta en la pantalla.
        await supabase
          .from('crm_mensajes')
          .update({ payload: { ...fila.payload, enviado: r.payload } })
          .eq('id', fila.id)
        if (r.simulado) res.simulados++
        else res.enviados++
      } else {
        await supabase.rpc('whatsapp_salida_fallido', {
          p_mensaje: fila.id,
          p_codigo: r.codigo,
          p_error: r.error,
        })
        if (r.codigo === '190') res.sinCredencial++
        else if (r.codigo === '130429') res.incompleto = true
        else res.fallidos++
      }
    }
  }

  return res
}

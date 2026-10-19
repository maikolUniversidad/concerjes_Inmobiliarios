// Geocerca: distancia punto–lectura contra el radio, con la PRECISIÓN incluida.
//
// Espejo de `ronda_geocerca_evaluar()` de la migración
// 20261019000040_puntos_qr_f4_ejecucion.sql. La base es la que manda —la
// respetan la PWA, el bot y la cola offline—; esto existe para que la pantalla
// pueda avisar ANTES de mandar, y para que funcione sin señal (el ADR-02 §2.9
// pide que la distancia a la geocerca se calcule en el dispositivo). Si cambia
// una, cambia la otra.
//
// La regla que importa: si la precisión reportada por el GPS es PEOR que el
// radio, no se puede distinguir "dentro" de "fuera". Eso NO se rechaza en
// silencio ni se da por bueno: se pide reintentar, se marca la ubicación como
// dudosa y, si la persona insiste, se exige motivo. Un conserje en un sótano
// con ±80 m de precisión no está haciendo nada mal.

export interface Lectura {
  lat: number | null
  lng: number | null
  /** Metros de incertidumbre que reporta el navegador (`coords.accuracy`). */
  precisionMetros?: number | null
  /** Hora del dispositivo en que se tomó la lectura. */
  capturadoEn?: string | null
}

export interface PuntoGeo {
  lat: number | null
  lng: number | null
  geocercaMetros: number
  exigeGeocerca: boolean
}

export interface Geocerca {
  /** ¿El punto (o la plantilla) exige estar dentro? */
  exige: boolean
  radioMetros: number
  distanciaMetros: number | null
  /** null = no se puede saber (faltan coordenadas). */
  dentro: boolean | null
  /** La precisión es peor que el radio: dentro y fuera no se distinguen. */
  dudosa: boolean
  sinGps: boolean
  /** La pantalla debe ofrecer "volver a intentar" antes de dejar seguir. */
  pedirReintento: boolean
  /** La base va a exigir motivo si se abre así. */
  exigeMotivo: boolean
  /** Qué decirle a la persona, en una frase. */
  mensaje: string
}

const RADIO_TIERRA_M = 6371008.8
const rad = (g: number) => (g * Math.PI) / 180

/** Distancia en metros entre dos coordenadas (haversine). */
export function distanciaMetros(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const dLat = rad(lat2 - lat1)
  const dLng = rad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2
  return Math.round(2 * RADIO_TIERRA_M * Math.asin(Math.sqrt(a)) * 100) / 100
}

/**
 * Evalúa una lectura contra el punto. `exigeGeocercaPlantilla` solo puede
 * ENDURECER lo que pide el punto, nunca relajarlo (así lo dice F3 en
 * `ronda_plantillas.exige_geocerca`).
 */
export function evaluarGeocerca(
  punto: PuntoGeo,
  lectura: Lectura,
  exigeGeocercaPlantilla = false,
): Geocerca {
  const radio = punto.geocercaMetros > 0 ? punto.geocercaMetros : 30
  const exige = punto.exigeGeocerca || exigeGeocercaPlantilla
  const faltan = lectura.lat == null || lectura.lng == null
    || punto.lat == null || punto.lng == null

  if (faltan) {
    const sinLectura = lectura.lat == null || lectura.lng == null
    return {
      exige, radioMetros: radio, distanciaMetros: null, dentro: null,
      dudosa: false, sinGps: true,
      pedirReintento: exige && sinLectura,
      // Sin coordenadas no hay nada que justificar: ni dentro ni fuera.
      exigeMotivo: false,
      mensaje: sinLectura
        ? 'No se pudo leer la ubicación del celular. Puedes intentar de nuevo al aire libre.'
        : 'Este punto todavía no tiene ubicación levantada, así que no se compara la geocerca.',
    }
  }

  const distancia = distanciaMetros(
    lectura.lat as number, lectura.lng as number, punto.lat as number, punto.lng as number)
  const dentro = distancia <= radio
  const precision = lectura.precisionMetros ?? null
  const dudosa = precision != null && precision > radio

  let mensaje: string
  if (dudosa && dentro) {
    mensaje = `La ubicación llegó con ±${Math.round(precision as number)} m, peor que la geocerca de ${radio} m: no se puede confirmar que estés en el punto.`
  } else if (dudosa) {
    mensaje = `Estás a ${Math.round(distancia)} m del punto y la ubicación llegó con ±${Math.round(precision as number)} m: la lectura no es confiable.`
  } else if (dentro) {
    mensaje = `Estás en el punto (a ${Math.round(distancia)} m de ${radio} m).`
  } else {
    mensaje = `Estás a ${Math.round(distancia)} m del punto y la geocerca es de ${radio} m.`
  }

  return {
    exige, radioMetros: radio, distanciaMetros: distancia, dentro, dudosa,
    sinGps: false,
    pedirReintento: dudosa || (exige && !dentro),
    exigeMotivo: !dentro || dudosa,
    mensaje,
  }
}

/** De dos lecturas, la mejor: la de menor incertidumbre. Es lo que hace la
 *  pantalla cuando el GPS va mejorando mientras la persona espera. */
export function mejorLectura(a: Lectura | null, b: Lectura | null): Lectura | null {
  if (!a) return b
  if (!b) return a
  const pa = a.precisionMetros ?? Number.POSITIVE_INFINITY
  const pb = b.precisionMetros ?? Number.POSITIVE_INFINITY
  return pb < pa ? b : a
}

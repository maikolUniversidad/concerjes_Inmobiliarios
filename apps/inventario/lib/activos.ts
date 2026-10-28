// Lo del activo del cliente que es LÓGICA PURA: estados, criticidad, tipos de
// documento, medidores y los textos de la consola (F6 del módulo de Puntos QR).
//
// Va aparte de las pantallas para que el script de pruebas
// (scripts/probar-puntos-qr-f6.mjs) pueda importarlo sin montar Next, igual que
// hace `lib/puntos-qr.ts` con lo del QR.
//
// Ojo con lo que NO es esto: `maquinaria` es el equipo PROPIO y móvil de la
// empresa (su QR es /equipo/<codigo>, con sesión y sin firma) y se mantiene
// aparte a propósito — la razón está en §4.2 del complemento 2 y es de
// seguridad, porque `mant_puede_participar()` no tiene alcance por contrato.
// Esto es la INSTALACIÓN DEL CLIENTE, fija en su sede, y su QR es /q/<token>.

export type EstadoActivo = 'OPERATIVO' | 'DEGRADADO' | 'FUERA_SERVICIO' | 'RETIRADO'
export type Criticidad = 'BAJA' | 'MEDIA' | 'ALTA' | 'CRITICA'
export type CategoriaActivo =
  | 'SEGURIDAD' | 'HIDRAULICO' | 'ELECTRICO' | 'MECANICO'
  | 'TRANSPORTE_VERTICAL' | 'ILUMINACION' | 'OBRA' | 'OTRO'
export type TipoMedidor = 'HORAS' | 'CICLOS' | 'LECTURA'
export type TipoDocumentoActivo =
  | 'FICHA_TECNICA' | 'MANUAL' | 'GARANTIA' | 'CERTIFICADO'
  | 'PLANO' | 'POLIZA' | 'FACTURA' | 'OTRO'
export type OrigenLectura = 'CONSOLA' | 'APP' | 'WHATSAPP' | 'IOT' | 'SISTEMA'

export const ESTADO_ACTIVO: Record<EstadoActivo, { label: string; badge: string; detalle: string }> = {
  OPERATIVO: {
    label: 'Operativo', badge: 'bg-emerald-100 text-emerald-700',
    detalle: 'Funciona como debe.',
  },
  DEGRADADO: {
    label: 'Degradado', badge: 'bg-amber-100 text-amber-700',
    detalle: 'Funciona a medias: sirve, pero con una falla conocida.',
  },
  FUERA_SERVICIO: {
    label: 'Fuera de servicio', badge: 'bg-red-100 text-red-700',
    detalle: 'No se puede usar.',
  },
  RETIRADO: {
    label: 'Retirado', badge: 'bg-gray-200 text-gray-700',
    detalle: 'Ya no hace parte de la operación. No se da de baja: el activo es del cliente.',
  },
}
export const ESTADOS_ACTIVO = Object.keys(ESTADO_ACTIVO) as EstadoActivo[]

export const CRITICIDAD: Record<Criticidad, { label: string; badge: string }> = {
  BAJA:    { label: 'Baja',    badge: 'bg-gray-100 text-gray-600' },
  MEDIA:   { label: 'Media',   badge: 'bg-sky-100 text-sky-700' },
  ALTA:    { label: 'Alta',    badge: 'bg-amber-100 text-amber-700' },
  CRITICA: { label: 'Crítica', badge: 'bg-red-100 text-red-700' },
}
export const CRITICIDADES = Object.keys(CRITICIDAD) as Criticidad[]

export const CATEGORIA_ACTIVO: Record<CategoriaActivo, string> = {
  SEGURIDAD: 'Seguridad',
  HIDRAULICO: 'Hidráulico',
  ELECTRICO: 'Eléctrico',
  MECANICO: 'Mecánico',
  TRANSPORTE_VERTICAL: 'Transporte vertical',
  ILUMINACION: 'Iluminación',
  OBRA: 'Obra civil',
  OTRO: 'Otro',
}
export const CATEGORIAS_ACTIVO = Object.keys(CATEGORIA_ACTIVO) as CategoriaActivo[]

export const TIPO_MEDIDOR: Record<TipoMedidor, { label: string; unidad: string; detalle: string }> = {
  HORAS: {
    label: 'Horas de funcionamiento', unidad: 'h',
    detalle: 'Contador que solo sube. El mantenimiento se programa cada tantas horas.',
  },
  CICLOS: {
    label: 'Ciclos', unidad: 'ciclos',
    detalle: 'Aperturas, carreras o arranques. También solo sube.',
  },
  LECTURA: {
    label: 'Lectura de instrumento', unidad: '',
    detalle: 'Presión, nivel o temperatura. Puede subir y bajar, así que no es acumulativo.',
  },
}
export const TIPOS_MEDIDOR = Object.keys(TIPO_MEDIDOR) as TipoMedidor[]

/** Un contador no baja; una lectura de instrumento sí. Es lo que la pantalla
 *  propone al crear el medidor, y lo que el trigger de la base exige después. */
export const acumulativoPorDefecto = (t: TipoMedidor) => t !== 'LECTURA'

export const TIPO_DOCUMENTO_ACTIVO: Record<TipoDocumentoActivo, { label: string; vence: boolean }> = {
  FICHA_TECNICA: { label: 'Ficha técnica', vence: false },
  MANUAL:        { label: 'Manual',        vence: false },
  GARANTIA:      { label: 'Garantía',      vence: true },
  CERTIFICADO:   { label: 'Certificado',   vence: true },
  PLANO:         { label: 'Plano',         vence: false },
  POLIZA:        { label: 'Póliza',        vence: true },
  FACTURA:       { label: 'Factura',       vence: false },
  OTRO:          { label: 'Otro',          vence: false },
}
export const TIPOS_DOCUMENTO_ACTIVO = Object.keys(TIPO_DOCUMENTO_ACTIVO) as TipoDocumentoActivo[]

export const ORIGEN_LECTURA: Record<OrigenLectura, string> = {
  CONSOLA: 'Consola',
  APP: 'App de campo',
  WHATSAPP: 'WhatsApp',
  IOT: 'Sensor',
  SISTEMA: 'Sistema',
}

// ──────────────────────────────────────────────────────────────────────────────
// Textos y cálculos de la consola
// ──────────────────────────────────────────────────────────────────────────────

/** Bytes a un texto corto: 1,4 MB. Mismo criterio que la pantalla de
 *  instructivos, para que los dos listados se lean igual. */
export function tamanoCorto(bytes: number | null | undefined): string {
  if (!bytes) return '—'
  const mb = bytes / 1_048_576
  if (mb >= 1) return `${mb.toFixed(1).replace('.', ',')} MB`
  return `${Math.round(bytes / 1024)} kB`
}

/** El valor de un medidor con su unidad y los decimales que tenga definidos:
 *  `12.345,5 h`. En español de Colombia: punto de miles, coma decimal. */
export function valorMedidor(
  valor: number | null | undefined, unidad: string, decimales = 0,
): string {
  if (valor === null || valor === undefined) return '—'
  const n = valor.toLocaleString('es-CO', {
    minimumFractionDigits: decimales, maximumFractionDigits: decimales,
  })
  return unidad ? `${n} ${unidad}` : n
}

/** Cómo se rotula una garantía: lo que importa es si ya venció y cuánto le
 *  falta, no la fecha cruda. `hoy` entra por parámetro para poder probarlo. */
export function estadoGarantia(
  hasta: string | null | undefined, hoy: Date = new Date(),
): { texto: string; badge: string; vencida: boolean } | null {
  if (!hasta) return null
  // Las fechas vienen como YYYY-MM-DD de la base: se comparan en texto para no
  // meter la zona horaria del navegador en una fecha sin hora.
  const hoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`
  const dias = Math.round(
    (Date.parse(hasta + 'T00:00:00Z') - Date.parse(hoyIso + 'T00:00:00Z')) / 86_400_000)
  if (dias < 0) {
    return { texto: `Garantía vencida hace ${Math.abs(dias)} días`, badge: 'bg-gray-200 text-gray-600', vencida: true }
  }
  if (dias === 0) return { texto: 'La garantía vence hoy', badge: 'bg-amber-100 text-amber-700', vencida: false }
  if (dias <= 60) {
    return { texto: `Garantía por ${dias} días más`, badge: 'bg-amber-100 text-amber-700', vencida: false }
  }
  return { texto: `En garantía hasta ${hasta}`, badge: 'bg-emerald-100 text-emerald-700', vencida: false }
}

/** ¿El medidor pasó su valor de alerta? Es la misma condición que la vista
 *  `vw_activos_medidor_vencido`, escrita aquí para que la pantalla no tenga que
 *  consultar la vista para pintar una fila que ya tiene en la mano. */
export function medidorEnAlerta(
  valorActual: number, valorAlerta: number | null | undefined,
): boolean {
  return valorAlerta !== null && valorAlerta !== undefined && valorActual >= valorAlerta
}

/** Ruta en el bucket privado `rondas` de un archivo del activo. La carpeta
 *  `activos/<id>/` es la que reconocen `activo_de_ruta()` y las políticas de
 *  storage de la migración: fuera de ella la subida se rechaza. */
export function rutaArchivoActivo(activoId: string, nombreArchivo: string): string {
  const ext = (nombreArchivo.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '')
  const base = nombreArchivo
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'archivo'
  return `activos/${activoId}/${Date.now()}-${base}.${ext}`
}

/** El árbol padre/hijo de §2.1, ordenado para pintarlo con sangría. Devuelve
 *  cada activo con su profundidad. Tolera una referencia a un padre que no está
 *  en la lista (porque la RLS no lo dejó ver): ese activo se trata como raíz. */
export function ordenarJerarquia<T extends { id: string; padreId: string | null; codigo: string }>(
  filas: T[],
): { fila: T; nivel: number }[] {
  const porPadre = new Map<string | null, T[]>()
  const ids = new Set(filas.map((f) => f.id))
  for (const f of filas) {
    const padre = f.padreId && ids.has(f.padreId) ? f.padreId : null
    const lista = porPadre.get(padre) ?? []
    lista.push(f)
    porPadre.set(padre, lista)
  }
  for (const lista of porPadre.values()) lista.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es'))

  const salida: { fila: T; nivel: number }[] = []
  const vistos = new Set<string>()
  const bajar = (padre: string | null, nivel: number) => {
    // El tope de profundidad existe por si la base alguna vez dejara pasar un
    // ciclo: la pantalla no se puede colgar por un dato malo.
    if (nivel > 20) return
    for (const f of porPadre.get(padre) ?? []) {
      if (vistos.has(f.id)) continue
      vistos.add(f.id)
      salida.push({ fila: f, nivel })
      bajar(f.id, nivel + 1)
    }
  }
  bajar(null, 0)
  // Lo que quedó fuera por un ciclo se agrega al final: mejor verlo que perderlo.
  for (const f of filas) if (!vistos.has(f.id)) salida.push({ fila: f, nivel: 0 })
  return salida
}

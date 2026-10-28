// Los textos de consentimiento que la persona lee ANTES del primer uso, con su
// versión y su hash.
//
// Se guarda el texto que leyó, no solo un «sí»: un consentimiento sin el texto
// aceptado no prueba nada (Ley 1581 de 2012, y la Parte 4 del documento 00).
// Es el mismo criterio de la tabla `consentimientos` del ATS, y por eso
// `persona_consentimientos` la calca.
//
// `BIOMETRIA` va APARTE y es lo último de la lista a propósito: negarse no
// puede impedir trabajar. Sin ese consentimiento la firma facial no se ofrece y
// se firma con trazo, y el motivo queda en `ronda_firmas.alternativa_motivo`
// (lo escribe un trigger de la base, no la pantalla).
//
// La versión es parte del texto: si el texto cambia, la versión sube y hay que
// volver a pedirlo. Nunca se edita un texto dejando la versión igual.

export type TipoConsentimiento =
  'UBICACION' | 'FOTOS' | 'AUDIO' | 'BIOMETRIA' | 'WHATSAPP' | 'SEGUIMIENTO'

export interface TextoConsentimiento {
  tipo: TipoConsentimiento
  version: string
  titulo: string
  /** Lo que se le muestra, en una pantalla de celular y sin letra menuda. */
  texto: string
  /** Si no se otorga, ¿qué deja de funcionar? Dicho sin amenazar. */
  siNo: string
  /** Hace falta para ejecutar una visita. BIOMETRIA nunca lo es. */
  necesario: boolean
}

export const CONSENTIMIENTOS: TextoConsentimiento[] = [
  {
    tipo: 'UBICACION',
    version: '2026-10-19.1',
    titulo: 'Ubicación mientras haces la ronda',
    texto:
      'Para confirmar que estuviste en el punto de control, la aplicación lee la ubicación de tu '
      + 'celular cuando abres y cierras una visita. Se guarda la coordenada, la precisión y la '
      + 'distancia al punto, junto con esa visita. No se sigue tu ubicación entre visitas ni fuera '
      + 'de tu turno. Los datos se conservan el tiempo que tenga pactado el contrato de la sede '
      + '(por defecto 12 meses) y después se borran.',
    siNo:
      'Puedes trabajar igual: la visita se abre sin ubicación y queda marcada como «sin GPS», que '
      + 'tu supervisor puede revisar.',
    necesario: false,
  },
  {
    // F8. APARTE de UBICACION, y no por formalismo: el texto de UBICACION
    // promete que «no se sigue tu ubicación entre visitas ni fuera de tu
    // turno», así que reutilizar ese «sí» para el seguimiento durante el turno
    // sería usarlo para algo que no autorizó. §10.3 del complemento 2 lo exige
    // explícitamente: «el seguimiento continuo exige consentimiento explícito
    // aparte y un indicador visible para el trabajador».
    tipo: 'SEGUIMIENTO',
    version: '2026-10-28.1',
    titulo: 'Ver tu ubicación durante el turno',
    texto:
      'Es APARTE de lo anterior y puedes decir que no. Si lo autorizas, mientras tengas el turno '
      + 'abierto en la aplicación tu supervisor puede ver en un mapa dónde estás, para coordinar el '
      + 'trabajo del día. Se guarda la coordenada cada pocos minutos, SOLO mientras el turno está '
      + 'abierto: al salir de turno dejas de aparecer en el mapa en el acto, y fuera del turno no se '
      + 'registra nada. Mientras esté activo, la aplicación te lo muestra en pantalla todo el tiempo. '
      + 'El recorrido se conserva los meses que tenga pactado el contrato de la sede (3 por defecto) '
      + 'y después se borra. Puedes retirar esta autorización cuando quieras.',
    siNo:
      'Puedes trabajar igual y abrir tus visitas como siempre: simplemente no apareces en el mapa '
      + 'del turno. No afecta tu trabajo ni tu evaluación.',
    necesario: false,
  },
  {
    tipo: 'FOTOS',
    version: '2026-10-19.1',
    titulo: 'Fotos del lugar',
    texto:
      'Las tareas piden fotos del sitio (un baño, una luminaria, un medidor). Se toman con la '
      + 'cámara en el momento, se guardan con la visita y de cada una se registra su huella digital '
      + '(un código que identifica el archivo) para poder demostrar después que es la foto que se '
      + 'tomó allí. Son fotos del LUGAR, no tuyas.',
    siNo:
      'No se pueden hacer las tareas que piden foto. Avísale a tu supervisor para que te asigne '
      + 'otras o registre la visita de otra forma.',
    necesario: true,
  },
  {
    tipo: 'AUDIO',
    version: '2026-10-19.1',
    titulo: 'Notas de voz',
    texto:
      'Algunas tareas te dejan grabar una nota de voz en vez de escribir. El audio se guarda con la '
      + 'visita y puede transcribirse a texto para que quede en el reporte.',
    siNo: 'Puedes escribir la nota en vez de grabarla. No cambia nada más.',
    necesario: false,
  },
  {
    tipo: 'WHATSAPP',
    version: '2026-10-19.1',
    titulo: 'Mensajes por WhatsApp',
    texto:
      'Al número que verificaste se te pueden mandar el enlace de acceso, los recordatorios de tus '
      + 'rondas y la confirmación de lo que reportaste. Puedes pedir que paren en cualquier momento.',
    siNo: 'No recibes mensajes. Para entrar sin cuenta tendrás que pedirle el acceso a tu supervisor.',
    necesario: false,
  },
  {
    tipo: 'BIOMETRIA',
    version: '2026-10-19.1',
    titulo: 'Verificación de tu rostro (opcional)',
    texto:
      'Es OPCIONAL y va aparte de todo lo anterior. Si lo autorizas, al firmar una visita se puede '
      + 'tomar una foto de tu rostro para comparar con la de tu ficha y confirmar que eres tú. Es un '
      + 'dato sensible: la ley exige tu autorización expresa y puedes retirarla cuando quieras.',
    siNo:
      'Firmas con tu trazo en la pantalla, como siempre, y queda registrado que la verificación de '
      + 'rostro no se usó porque no la autorizaste. No afecta tu trabajo ni tu evaluación.',
    necesario: false,
  },
]

/** SHA-256 del texto exacto que se mostró, en hexadecimal. */
export async function hashTexto(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Los que hacen falta para poder ejecutar una visita. BIOMETRIA no está. */
export const NECESARIOS = CONSENTIMIENTOS.filter((c) => c.necesario).map((c) => c.tipo)

// Armador de mensajes salientes, con los límites de WhatsApp metidos dentro.
//
// POR QUÉ ESTO EXISTE: si un mensaje que no cabe en WhatsApp se encola igual,
// Meta devuelve un error en producción y el conserje se queda esperando una
// respuesta que nunca llega, parado en un punto, de noche. Mejor que falle
// aquí, donde se ve en una prueba. Por eso el simulador respeta los MISMOS
// límites: un mensaje que no cabría en WhatsApp tiene que fallar también
// simulado, o el simulador no prueba nada.
//
// Los números no son opinión (documentación de Meta):
//   · lista: máximo 10 secciones y máximo 10 FILAS EN TOTAL; título de fila 24,
//     descripción de fila 72, texto del botón 20, `id` de fila hasta 200;
//   · botones de respuesta: máximo 3, título 20;
//   · cuerpo de texto 4.096; en un interactivo, cuerpo 1.024, encabezado 60,
//     pie 60.

export const LIMITES = {
  textoCuerpo: 4096,
  interactivoCuerpo: 1024,
  encabezado: 60,
  pie: 60,
  botonTexto: 20,
  botones: 3,
  listaBoton: 20,
  listaFilas: 10,
  listaSecciones: 10,
  filaTitulo: 24,
  filaDescripcion: 72,
  filaId: 200,
} as const

export class ErrorLimite extends Error {
  constructor(public readonly campo: string, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorLimite'
  }
}

export interface Boton {
  id: string
  texto: string
}
export interface Fila {
  id: string
  titulo: string
  descripcion?: string
}
export interface Seccion {
  titulo?: string
  filas: Fila[]
}

export type MensajeSaliente =
  | { tipo: 'TEXTO'; texto: string; vistaPrevia?: boolean }
  | {
      tipo: 'BOTONES'
      cuerpo: string
      botones: Boton[]
      encabezado?: string
      pie?: string
    }
  | {
      tipo: 'LISTA'
      cuerpo: string
      botonTexto: string
      secciones: Seccion[]
      encabezado?: string
      pie?: string
    }
  | { tipo: 'SOLICITUD_UBICACION'; cuerpo: string }
  | { tipo: 'IMAGEN'; enlace: string; pieFoto?: string }
  | { tipo: 'DOCUMENTO'; enlace: string; nombreArchivo?: string; pieFoto?: string }
  | {
      tipo: 'PLANTILLA'
      nombre: string
      idioma: string
      variables: string[]
      variablesEncabezado?: string[]
    }

function exigir(campo: string, valor: string | undefined, tope: number, obligatorio = false) {
  if (valor === undefined || valor === null || valor === '') {
    if (obligatorio) throw new ErrorLimite(campo, `${campo} no puede ir vacío.`)
    return
  }
  // Se cuenta en puntos de código y no en unidades UTF-16: un emoji es UN
  // carácter para quien escribe el texto, y los textos del bot llevan emoji.
  const largo = [...valor].length
  if (largo > tope) {
    throw new ErrorLimite(campo, `${campo} mide ${largo} caracteres y el tope de WhatsApp es ${tope}.`)
  }
}

/** Valida el mensaje contra los límites de WhatsApp. Lanza `ErrorLimite` con el
 *  campo y la medida: el mensaje de error es para quien lo tiene que arreglar. */
export function validar(m: MensajeSaliente): void {
  switch (m.tipo) {
    case 'TEXTO':
      exigir('texto', m.texto, LIMITES.textoCuerpo, true)
      break

    case 'BOTONES': {
      exigir('cuerpo', m.cuerpo, LIMITES.interactivoCuerpo, true)
      exigir('encabezado', m.encabezado, LIMITES.encabezado)
      exigir('pie', m.pie, LIMITES.pie)
      if (m.botones.length < 1 || m.botones.length > LIMITES.botones) {
        throw new ErrorLimite(
          'botones',
          `WhatsApp admite entre 1 y ${LIMITES.botones} botones de respuesta, y vienen ${m.botones.length}.`,
        )
      }
      const vistos = new Set<string>()
      for (const b of m.botones) {
        exigir('boton.texto', b.texto, LIMITES.botonTexto, true)
        exigir('boton.id', b.id, LIMITES.filaId, true)
        if (vistos.has(b.id)) throw new ErrorLimite('boton.id', `El id de botón "${b.id}" está repetido.`)
        vistos.add(b.id)
      }
      break
    }

    case 'LISTA': {
      exigir('cuerpo', m.cuerpo, LIMITES.interactivoCuerpo, true)
      exigir('encabezado', m.encabezado, LIMITES.encabezado)
      exigir('pie', m.pie, LIMITES.pie)
      exigir('botonTexto', m.botonTexto, LIMITES.listaBoton, true)
      if (m.secciones.length < 1 || m.secciones.length > LIMITES.listaSecciones) {
        throw new ErrorLimite(
          'secciones',
          `WhatsApp admite entre 1 y ${LIMITES.listaSecciones} secciones, y vienen ${m.secciones.length}.`,
        )
      }
      const total = m.secciones.reduce((n, s) => n + s.filas.length, 0)
      if (total < 1 || total > LIMITES.listaFilas) {
        throw new ErrorLimite(
          'filas',
          `Una lista de WhatsApp admite ${LIMITES.listaFilas} filas EN TOTAL (sumando las secciones), y vienen ${total}.`,
        )
      }
      const vistos = new Set<string>()
      for (const s of m.secciones) {
        exigir('seccion.titulo', s.titulo, LIMITES.filaTitulo)
        for (const f of s.filas) {
          exigir('fila.titulo', f.titulo, LIMITES.filaTitulo, true)
          exigir('fila.descripcion', f.descripcion, LIMITES.filaDescripcion)
          exigir('fila.id', f.id, LIMITES.filaId, true)
          if (vistos.has(f.id)) throw new ErrorLimite('fila.id', `El id de fila "${f.id}" está repetido.`)
          vistos.add(f.id)
        }
      }
      break
    }

    case 'SOLICITUD_UBICACION':
      exigir('cuerpo', m.cuerpo, LIMITES.interactivoCuerpo, true)
      break

    case 'IMAGEN':
    case 'DOCUMENTO':
      if (!m.enlace) throw new ErrorLimite('enlace', 'Un medio necesita su enlace.')
      exigir('pieFoto', m.pieFoto, LIMITES.textoCuerpo)
      break

    case 'PLANTILLA':
      if (!m.nombre) throw new ErrorLimite('nombre', 'Una plantilla necesita su nombre.')
      break
  }
}

/** Corta un texto al tope dejando puntos suspensivos. Para títulos y
 *  descripciones que vienen de datos (el nombre de un punto puede ser largo),
 *  NO para los textos del bot: esos se escriben para que quepan. */
export function recortar(texto: string, tope: number): string {
  const cp = [...(texto ?? '')]
  if (cp.length <= tope) return cp.join('')
  return cp.slice(0, Math.max(tope - 1, 1)).join('').trimEnd() + '…'
}

/** Parte un texto largo en varios mensajes, por párrafos y sin cortar palabras.
 *  Lo usa el instructivo de una tarea, que puede pasar de 4.096 caracteres. */
export function partir(texto: string, tope = LIMITES.textoCuerpo): string[] {
  const t = (texto ?? '').trim()
  if (!t) return []
  if ([...t].length <= tope) return [t]
  const partes: string[] = []
  let actual = ''
  for (const linea of t.split('\n')) {
    const candidato = actual ? `${actual}\n${linea}` : linea
    if ([...candidato].length <= tope) {
      actual = candidato
      continue
    }
    if (actual) partes.push(actual)
    // Una sola línea más larga que el tope: se parte a lo bruto, pero por
    // puntos de código, para no romper un emoji por la mitad.
    let resto = [...linea]
    while (resto.length > tope) {
      partes.push(resto.slice(0, tope).join(''))
      resto = resto.slice(tope)
    }
    actual = resto.join('')
  }
  if (actual) partes.push(actual)
  return partes
}

/** Traduce el mensaje al cuerpo que espera la Cloud API. Se construye aquí y no
 *  en el cliente para que el simulador vea EXACTAMENTE el mismo JSON que
 *  saldría hacia Meta. */
export function aPayloadMeta(destino: string, m: MensajeSaliente): Record<string, unknown> {
  validar(m)
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: destino }

  switch (m.tipo) {
    case 'TEXTO':
      return { ...base, type: 'text', text: { body: m.texto, preview_url: m.vistaPrevia ?? false } }

    case 'BOTONES':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(m.encabezado ? { header: { type: 'text', text: m.encabezado } } : {}),
          body: { text: m.cuerpo },
          ...(m.pie ? { footer: { text: m.pie } } : {}),
          action: {
            buttons: m.botones.map((b) => ({
              type: 'reply',
              reply: { id: b.id, title: b.texto },
            })),
          },
        },
      }

    case 'LISTA':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(m.encabezado ? { header: { type: 'text', text: m.encabezado } } : {}),
          body: { text: m.cuerpo },
          ...(m.pie ? { footer: { text: m.pie } } : {}),
          action: {
            button: m.botonTexto,
            sections: m.secciones.map((s) => ({
              ...(s.titulo ? { title: s.titulo } : {}),
              rows: s.filas.map((f) => ({
                id: f.id,
                title: f.titulo,
                ...(f.descripcion ? { description: f.descripcion } : {}),
              })),
            })),
          },
        },
      }

    case 'SOLICITUD_UBICACION':
      return {
        ...base,
        type: 'interactive',
        interactive: {
          type: 'location_request_message',
          body: { text: m.cuerpo },
          action: { name: 'send_location' },
        },
      }

    case 'IMAGEN':
      return { ...base, type: 'image', image: { link: m.enlace, ...(m.pieFoto ? { caption: m.pieFoto } : {}) } }

    case 'DOCUMENTO':
      return {
        ...base,
        type: 'document',
        document: {
          link: m.enlace,
          ...(m.nombreArchivo ? { filename: m.nombreArchivo } : {}),
          ...(m.pieFoto ? { caption: m.pieFoto } : {}),
        },
      }

    case 'PLANTILLA': {
      const comp: Record<string, unknown>[] = []
      if (m.variablesEncabezado?.length) {
        comp.push({
          type: 'header',
          parameters: m.variablesEncabezado.map((t) => ({ type: 'text', text: t })),
        })
      }
      if (m.variables.length) {
        comp.push({ type: 'body', parameters: m.variables.map((t) => ({ type: 'text', text: t })) })
      }
      return {
        ...base,
        type: 'template',
        template: {
          name: m.nombre,
          language: { code: m.idioma },
          ...(comp.length ? { components: comp } : {}),
        },
      }
    }
  }
}

/** Resumen de una línea del mensaje, para la consola y el simulador. */
export function describir(m: MensajeSaliente): string {
  switch (m.tipo) {
    case 'TEXTO':
      return m.texto
    case 'BOTONES':
      return `${m.cuerpo}\n[ ${m.botones.map((b) => b.texto).join(' | ')} ]`
    case 'LISTA':
      return `${m.cuerpo}\n[${m.botonTexto}] ${m.secciones
        .flatMap((s) => s.filas.map((f) => f.titulo))
        .join(' · ')}`
    case 'SOLICITUD_UBICACION':
      return `${m.cuerpo}\n[ Enviar ubicación ]`
    case 'IMAGEN':
      return `[imagen] ${m.pieFoto ?? m.enlace}`
    case 'DOCUMENTO':
      return `[documento] ${m.nombreArchivo ?? m.enlace}`
    case 'PLANTILLA':
      return `[plantilla ${m.nombre}] ${m.variables.join(' · ')}`
  }
}

/** Una lista de hasta 9 filas más «Ver más ▸» cuando hay de sobra. El límite de
 *  WhatsApp es 10 filas EN TOTAL, así que la décima se reserva para paginar. */
export function listaPaginada(
  filas: Fila[],
  pagina: number,
  idSiguiente: (pagina: number) => string,
  tituloSiguiente = 'Ver más ▸',
): { filas: Fila[]; hayMas: boolean } {
  const porPagina = LIMITES.listaFilas - 1
  const desde = Math.max(pagina - 1, 0) * porPagina
  const trozo = filas.slice(desde, desde + porPagina)
  const hayMas = filas.length > desde + porPagina
  if (hayMas) {
    trozo.push({ id: idSiguiente(Math.max(pagina, 1) + 1), titulo: tituloSiguiente })
  }
  return { filas: trozo, hayMas }
}

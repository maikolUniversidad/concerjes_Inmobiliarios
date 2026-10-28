// Lectura de los payloads del webhook y comandos del bot.
//
// Las formas de los payloads son las de la referencia de Meta, con sus propios
// valores de ejemplo. Los números de teléfono son INVENTADOS y fuera de rangos
// reales: este repositorio es público.
//
// Lo que estas pruebas cuidan: que un POST agrupado se descomponga bien, que la
// deduplicación sea estable, y que NADA de lo que llega se interprete como una
// orden. Un `text.body` es texto que escribió alguien.

import { describe, expect, it } from 'vitest'
import { descomponer, esEstado, leerEstado, leerMensaje, llaveDedup, tipoMensaje } from '@/lib/whatsapp/entrada'
import { codigoDePunto, documento, esSaludo, medicion, normalizar, reconocer, siONo } from '@/lib/whatsapp/comandos'
import { agrupar, armarPayload, EJEMPLO, nuevoWamid } from '@/lib/whatsapp/simulador'

const WA = '573000000091' // inventado, fuera de rangos reales

describe('descomponer', () => {
  it('un mensaje de texto se vuelve un evento con su wamid', () => {
    const e = descomponer(armarPayload({ clase: 'texto', waId: WA, texto: 'hola' }))
    expect(e).toHaveLength(1)
    expect(e[0].tipoCampo).toBe('messages')
    expect(e[0].waId).toBe(WA)
    expect(e[0].dedup).toBe(e[0].wamid)
    expect(e[0].wamid?.startsWith('wamid.')).toBe(true)
  })

  it('UN POST con 50 actualizaciones se descompone en 50 eventos', () => {
    // Meta agrupa hasta 1.000 en un solo POST y el agrupamiento no está
    // garantizado: hay que tratar cada una por separado.
    const lote = agrupar(
      Array.from({ length: 50 }, (_, i) => armarPayload({ clase: 'texto', waId: WA, texto: `m${i}` })),
    )
    const e = descomponer(lote)
    expect(e).toHaveLength(50)
    expect(new Set(e.map((x) => x.dedup)).size).toBe(50)
  })

  it('un lote mezclado de mensajes y estados sale completo', () => {
    const lote = agrupar([
      armarPayload({ clase: 'texto', waId: WA, texto: 'uno' }),
      armarPayload({ clase: 'estado', waId: WA, wamidDestino: 'wamid.OUT1', estadoEntrega: 'delivered' }),
      armarPayload({ clase: 'imagen', waId: WA }),
    ])
    const e = descomponer(lote)
    expect(e).toHaveLength(3)
    expect(e.filter((x) => esEstado(x.payload))).toHaveLength(1)
  })

  it('el timestamp de Meta (segundos) se convierte a ISO', () => {
    const e = descomponer(armarPayload({ clase: 'texto', waId: WA, texto: 'x', momento: 1764330000 }))
    expect(e[0].momento).toBe(new Date(1764330000 * 1000).toISOString())
  })

  it('un cuerpo vacío o raro no revienta y no inventa eventos', () => {
    for (const malo of [null, undefined, {}, { entry: null }, { entry: [{}] }, { entry: [{ changes: 'no' }] }, 42, 'texto']) {
      expect(() => descomponer(malo), JSON.stringify(malo)).not.toThrow()
    }
    expect(descomponer({})).toHaveLength(0)
  })

  it('un cambio que no es mensaje ni estado SE GUARDA IGUAL', () => {
    // No hay API para recuperar un webhook viejo: lo que no se guarde se pierde
    // para siempre. Un cambio de calidad del número o de estado de plantilla
    // tiene que quedar aunque todavía no haya quién lo consuma.
    const e = descomponer({
      object: 'whatsapp_business_account',
      entry: [{
        id: EJEMPLO.wabaId,
        changes: [{ field: 'message_template_status_update', value: { event: 'APPROVED', message_template_name: 'x' } }],
      }],
    })
    expect(e).toHaveLength(1)
    expect(e[0].tipoCampo).toBe('message_template_status_update')
    expect(e[0].wamid).toBeNull()
    expect(e[0].dedup).toMatch(/^[0-9a-f]{64}$/)
  })

  it('un mensaje sin id se descarta en vez de entrar sin llave', () => {
    const e = descomponer({
      object: 'whatsapp_business_account',
      entry: [{ id: '1', changes: [{ field: 'messages', value: { messages: [{ from: WA, type: 'text' }] } }] }],
    })
    expect(e).toHaveLength(0)
  })
})

describe('llaveDedup', () => {
  it('el mismo contenido da la misma llave, en cualquier orden de claves', () => {
    const a = llaveDedup('statuses', { id: 'x', status: 'read', ts: 1 })
    const b = llaveDedup('statuses', { ts: 1, status: 'read', id: 'x' })
    expect(a).toBe(b)
  })
  it('contenidos distintos dan llaves distintas', () => {
    expect(llaveDedup('statuses', { id: 'x', status: 'read' }))
      .not.toBe(llaveDedup('statuses', { id: 'x', status: 'sent' }))
  })
  it('dos estados del mismo mensaje son DOS eventos', () => {
    // `delivered` y `read` del mismo wamid no se pueden deduplicar entre sí: son
    // dos hechos distintos.
    const entregado = descomponer(armarPayload({ clase: 'estado', waId: WA, wamidDestino: 'wamid.OUT1', estadoEntrega: 'delivered', momento: 100 }))
    const leido = descomponer(armarPayload({ clase: 'estado', waId: WA, wamidDestino: 'wamid.OUT1', estadoEntrega: 'read', momento: 200 }))
    expect(entregado[0].dedup).not.toBe(leido[0].dedup)
  })
  it('el MISMO evento repetido da la misma llave (es lo que dedupla)', () => {
    const uno = descomponer(armarPayload({ clase: 'estado', waId: WA, wamidDestino: 'wamid.OUT1', estadoEntrega: 'read', momento: 200 }))
    const dos = descomponer(armarPayload({ clase: 'estado', waId: WA, wamidDestino: 'wamid.OUT1', estadoEntrega: 'read', momento: 200 }))
    expect(uno[0].dedup).toBe(dos[0].dedup)
  })
  it('un wamid fijo repetido da el mismo dedup', () => {
    const w = nuevoWamid('FIJO')
    const a = descomponer(armarPayload({ clase: 'texto', waId: WA, texto: 'x', wamid: w }))
    const b = descomponer(armarPayload({ clase: 'texto', waId: WA, texto: 'y', wamid: w }))
    expect(a[0].dedup).toBe(b[0].dedup)
  })
})

describe('leerMensaje', () => {
  const uno = (p: Record<string, unknown>) => leerMensaje(descomponer(p)[0])

  it('texto', () => {
    const m = uno(armarPayload({ clase: 'texto', waId: WA, texto: 'PUNTO K7M-4QX9', perfil: 'Prueba' }))
    expect(m).toMatchObject({ clase: 'TEXTO', texto: 'PUNTO K7M-4QX9', waId: WA, perfilNombre: 'Prueba' })
  })

  it('botón de respuesta', () => {
    const m = uno(armarPayload({ clase: 'boton', waId: WA, idRespuesta: 'resumen:confirmar', tituloRespuesta: 'Confirmar' }))
    expect(m).toMatchObject({ clase: 'BOTON', idRespuesta: 'resumen:confirmar' })
  })

  it('fila de lista', () => {
    const m = uno(armarPayload({ clase: 'lista', waId: WA, idRespuesta: 'tarea:abc', tituloRespuesta: 'Revisar extintor' }))
    expect(m).toMatchObject({ clase: 'LISTA', idRespuesta: 'tarea:abc' })
  })

  it('ubicación, con su context.id para casarla con la pregunta', () => {
    const m = uno(armarPayload({
      clase: 'ubicacion', waId: WA, lat: 4.6512, lng: -74.1003,
      nombreUbicacion: 'Portería', contextoWamid: 'wamid.PREGUNTA',
    }))
    expect(m).toMatchObject({ clase: 'UBICACION', lat: 4.6512, lng: -74.1003, contextoWamid: 'wamid.PREGUNTA' })
  })

  it('la ubicación NO trae precisión del GPS, y el tipo no la finge', () => {
    const m = uno(armarPayload({ clase: 'ubicacion', waId: WA, lat: 4.65, lng: -74.1 }))
    expect(Object.keys(m!)).not.toContain('precision')
  })

  it('imagen con su media_id y su sha256 declarado', () => {
    const m = uno(armarPayload({ clase: 'imagen', waId: WA, mediaId: 'media-1', mime: 'image/jpeg' }))
    expect(m).toMatchObject({ clase: 'IMAGEN', mediaId: 'media-1', mime: 'image/jpeg', comoDocumento: false })
    expect(m!.sha256Declarado).toBeTruthy()
  })

  it('una IMAGEN mandada COMO DOCUMENTO se lee como imagen y se marca', () => {
    // Es el único caso en que WhatsApp conserva el EXIF: ahí sí hay metadatos.
    const m = uno(armarPayload({ clase: 'documento', waId: WA, mime: 'image/jpeg', nombreArchivo: 'foto.jpg' }))
    expect(m).toMatchObject({ clase: 'IMAGEN', comoDocumento: true, nombreArchivo: 'foto.jpg' })
  })

  it('un PDF como documento se lee como documento', () => {
    const m = uno(armarPayload({ clase: 'documento', waId: WA, mime: 'application/pdf', nombreArchivo: 'acta.pdf' }))
    expect(m!.clase).toBe('DOCUMENTO')
  })

  it('una nota de voz se distingue de un audio adjunto', () => {
    expect(uno(armarPayload({ clase: 'audio', waId: WA, voz: true }))!.voz).toBe(true)
    expect(uno(armarPayload({ clase: 'audio', waId: WA, voz: false }))!.voz).toBe(false)
  })

  it('un sticker no se confunde con una foto', () => {
    expect(uno(armarPayload({ clase: 'sticker', waId: WA }))!.clase).toBe('STICKER')
  })

  it('un tipo que no se conoce queda NO_SOPORTADO, no se adivina', () => {
    const m = leerMensaje({
      tipoCampo: 'messages', dedup: 'w1', wamid: 'w1', waId: WA, phoneNumberId: null, momento: null,
      payload: { message: { id: 'w1', from: WA, type: 'ubicacion_en_vivo_que_no_existe' } },
    })
    expect(m!.clase).toBe('NO_SOPORTADO')
  })

  it('lee messages[].errors, como el `type: unsupported`', () => {
    const m = leerMensaje({
      tipoCampo: 'messages', dedup: 'w1', wamid: 'w1', waId: WA, phoneNumberId: null, momento: null,
      payload: { message: { id: 'w1', from: WA, type: 'unsupported', errors: [{ code: 131051, title: 'Unsupported message type' }] } },
    })
    expect(m!.errores).toEqual([{ code: 131051, title: 'Unsupported message type', message: undefined }])
  })

  it('marca el ECO de un mensaje mandado desde la app del teléfono', () => {
    const m = leerMensaje({
      tipoCampo: 'smb_message_echoes', dedup: 'w1', wamid: 'w1', waId: WA, phoneNumberId: null, momento: null,
      payload: { field: 'smb_message_echoes', message: { id: 'w1', from: WA, type: 'text', text: { body: 'desde la app' } } },
    })
    // El eco NO abre la ventana de 24 h: lo escribió la empresa, no la persona.
    expect(m!.eco).toBe(true)
  })

  it('tipoMensaje mapea cada clase a un valor del CHECK de crm_mensajes', () => {
    const validos = ['TEXTO', 'IMAGEN', 'AUDIO', 'VIDEO', 'DOCUMENTO', 'UBICACION', 'BOTONES', 'LISTA',
      'SOLICITUD_UBICACION', 'PLANTILLA', 'CONTACTO', 'STICKER', 'REACCION', 'SISTEMA', 'NO_SOPORTADO']
    for (const c of ['TEXTO', 'BOTON', 'LISTA', 'UBICACION', 'IMAGEN', 'AUDIO', 'VIDEO', 'DOCUMENTO',
      'STICKER', 'CONTACTO', 'REACCION', 'NO_SOPORTADO'] as const) {
      expect(validos, c).toContain(tipoMensaje(c))
    }
  })
})

describe('leerEstado', () => {
  it('lee sent / delivered / read', () => {
    for (const e of ['sent', 'delivered', 'read'] as const) {
      const ev = descomponer(armarPayload({ clase: 'estado', waId: WA, wamidDestino: 'wamid.OUT', estadoEntrega: e }))[0]
      expect(leerEstado(ev)).toMatchObject({ wamid: 'wamid.OUT', estado: e, waId: WA })
    }
  })
  it('un failed trae su código de error', () => {
    const ev = descomponer(armarPayload({ clase: 'estado', waId: WA, wamidDestino: 'wamid.OUT', estadoEntrega: 'failed' }))[0]
    expect(leerEstado(ev)).toMatchObject({ estado: 'failed', codigoError: '131026' })
  })
})

describe('comandos', () => {
  it('normalizar quita tildes, signos y espacios de más', () => {
    expect(normalizar('  ¿Me   ayudás? ')).toBe('ME AYUDAS')
    expect(normalizar('Ubicación')).toBe('UBICACION')
  })

  it('reconoce los comandos con y sin tildes, en mayúscula y en minúscula', () => {
    const casos: [string, string][] = [
      ['AYUDA', 'AYUDA'], ['ayuda', 'AYUDA'], ['¿me ayudás?', 'AYUDA'], ['no entiendo', 'AYUDA'],
      ['MIS PUNTOS', 'MIS_PUNTOS'], ['mis puntos', 'MIS_PUNTOS'], ['¿cuáles son mis puntos?', 'MIS_PUNTOS'],
      ['SIGUIENTE', 'SIGUIENTE'], ['ya terminé', 'SIGUIENTE'], ['terminar punto', 'SIGUIENTE'],
      ['NOVEDAD', 'NOVEDAD'], ['reportar un problema', 'NOVEDAD'],
      ['CANCELAR', 'CANCELAR'], ['cancelá', 'CANCELAR'],
      ['CREAR QR', 'CREAR_QR'], ['crear punto', 'CREAR_QR'],
      ['HABLAR CON SUPERVISOR', 'SUPERVISOR'], ['quiero hablar con mi supervisor', 'SUPERVISOR'],
      ['PRIVACIDAD', 'PRIVACIDAD'], ['mis permisos', 'PRIVACIDAD'], ['borrar mis datos', 'PRIVACIDAD'],
    ]
    for (const [texto, esperado] of casos) expect(reconocer(texto), texto).toBe(esperado)
  })

  it('«mis puntos» no se confunde con «crear punto»', () => {
    expect(reconocer('mis puntos')).toBe('MIS_PUNTOS')
    expect(reconocer('crear punto')).toBe('CREAR_QR')
  })

  it('«hablar con supervisor» no cae en AYUDA', () => {
    expect(reconocer('hablar con supervisor')).toBe('SUPERVISOR')
  })

  it('un mensaje normal no es un comando', () => {
    for (const t of ['el bombillo está quemado', 'presión 12 bar', 'PUNTO K7M-4QX9', '', '   ']) {
      expect(reconocer(t), t).toBeNull()
    }
  })

  it('reconoce un saludo', () => {
    for (const s of ['hola', 'HOLA', 'buenas', 'buenos días', 'qué más', 'hola buenas tardes']) {
      expect(esSaludo(s), s).toBe(true)
    }
    expect(esSaludo('el bombillo está quemado')).toBe(false)
  })

  it('siONo lee un sí y un no escritos a mano', () => {
    expect(siONo('sí')).toBe(true)
    expect(siONo('dale')).toBe(true)
    expect(siONo('no')).toBe(false)
    expect(siONo('tal vez')).toBeNull()
  })
})

describe('codigoDePunto', () => {
  it('acepta las formas en que la gente lo escribe', () => {
    for (const t of ['PUNTO K7M-4QX9', 'punto k7m4qx9', 'K7M-4QX9', 'k7m 4qx9', 'código K7M4QX9', 'QR k7m-4qx9']) {
      expect(codigoDePunto(t), t).toBe('K7M4QX9')
    }
  })

  it('no confunde una frase con un código', () => {
    for (const t of ['buenas tardes', 'el bombillo está quemado', 'hola', 'ABCDEFGH', '12345678', '']) {
      expect(codigoDePunto(t), t).toBeNull()
    }
  })

  it('exige al menos una letra Y un dígito', () => {
    expect(codigoDePunto('SOLOLETRAS')).toBeNull()
    expect(codigoDePunto('12345')).toBeNull()
    expect(codigoDePunto('A1B2')).toBe('A1B2')
  })

  it('no acepta algo demasiado largo ni demasiado corto', () => {
    expect(codigoDePunto('A1')).toBeNull()
    expect(codigoDePunto('A1' + 'B2'.repeat(20))).toBeNull()
  })
})

describe('documento', () => {
  it('acepta con y sin puntos', () => {
    expect(documento('1.234.567')).toBe('1234567')
    expect(documento('  1234567  ')).toBe('1234567')
  })
  it('rechaza lo que no es un documento', () => {
    for (const t of ['', '123', 'hola', '1'.repeat(16)]) expect(documento(t), t).toBeNull()
  })
})

describe('medicion', () => {
  it('extrae número y unidad de las formas naturales', () => {
    expect(medicion('presión 12 bar')).toEqual({ valor: 12, unidad: 'bar' })
    expect(medicion('nivel 80%')).toEqual({ valor: 80, unidad: '%' })
    expect(medicion('3 extintores')).toEqual({ valor: 3, unidad: 'extintores' })
    expect(medicion('12')).toEqual({ valor: 12, unidad: null })
  })
  it('entiende la coma decimal, que es como se escribe en Colombia', () => {
    expect(medicion('12,5 bar')).toEqual({ valor: 12.5, unidad: 'bar' })
  })
  it('acepta un negativo', () => {
    expect(medicion('-3 grados')).toEqual({ valor: -3, unidad: 'grados' })
  })
  it('devuelve null cuando no hay ningún número', () => {
    expect(medicion('todo bien')).toBeNull()
    expect(medicion('')).toBeNull()
  })
})

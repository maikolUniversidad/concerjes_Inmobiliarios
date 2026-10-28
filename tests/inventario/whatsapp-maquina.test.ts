// La máquina de estados de una visita por WhatsApp (§4 del ADR-01).
//
// Se prueba como FUNCIÓN PURA: `(estado, evento, contexto) → (estado', acciones)`,
// sin red y sin base. Es el corazón del módulo, y lo que más se rompe solo son
// los vencimientos y los estados de error, que en producción solo se ven cuando
// alguien ya se quedó esperando.
//
// Las tres reglas que estas pruebas defienden por encima de todo:
//   1. EL SISTEMA NUNCA CONFIRMA EN NOMBRE DE LA PERSONA.
//   2. NUNCA SE BLOQUEA EL TRABAJO: fuera de geocerca, sin foto o sin
//      consentimiento, la visita sigue con su novedad anotada.
//   3. EL BOT NO ESCRIBE FUERA DE LA JORNADA (art. 3 de la Ley 2191 de 2022).

import { describe, expect, it } from 'vitest'
import {
  avanzar, REINTENTOS, RELOJES,
  type Accion, type ContextoMaquina, type EstadoConversacion, type EventoMaquina, type TareaCtx,
  type MenuOpcion,
} from '@/lib/whatsapp/maquina'

const PUNTO = {
  id: 'p-1',
  codigo: 'K7M4QX9',
  nombre: 'Portería principal',
  sedeNombre: 'Conjunto de prueba',
  radioM: 75,
  exigeGeocerca: true,
  duracionMin: 20,
}

const tarea = (id: string, estado: TareaCtx['estado'] = 'PENDIENTE', tipo = 'CASILLA'): TareaCtx => ({
  id,
  titulo: `Tarea ${id}`,
  descripcion: null,
  tipo,
  estado,
  instructivo: null,
})

function ctx(p: Partial<ContextoMaquina> = {}): ContextoMaquina {
  return {
    identificada: true,
    personaNombreCorto: 'A',
    bloqueada: false,
    jornadaAbierta: true,
    ventanaAbierta: true,
    consiente: { UBICACION: true, FOTOS: true, AUDIO: true, BIOMETRIA: false },
    intentos: 0,
    punto: PUNTO,
    visitaId: 'v-1',
    visitaNumero: 'RV-000001',
    tareas: [],
    tareaActual: null,
    puntosDelDia: [{ codigo: 'K7M4QX9', nombre: 'Portería principal', sedeNombre: 'Conjunto de prueba', estado: 'PENDIENTE' }],
    menu: [],
    proximaParada: null,
    geocerca: null,
    puntoBuscado: null,
    visitaAbiertaEnOtroPunto: null,
    puedeCrearQr: false,
    fotos: 0,
    notasVoz: 0,
    inicioVisita: '2026-10-28T13:00:00.000Z',
    transcripcion: null,
    datos: {},
    ...p,
  }
}

const ev = (e: Partial<EventoMaquina> & Pick<EventoMaquina, 'clase'>): EventoMaquina => ({
  momento: '2026-10-28T13:30:00.000Z',
  ...e,
})

const tipos = (acciones: Accion[]) => acciones.map((a) => a.tipo)
const textos = (acciones: Accion[]) =>
  acciones
    .filter((a): a is Extract<Accion, { tipo: 'MENSAJE' }> => a.tipo === 'MENSAJE')
    .map((a) => ('texto' in a.mensaje ? a.mensaje.texto : 'cuerpo' in a.mensaje ? a.mensaje.cuerpo : a.mensaje.tipo))
    .join('\n')
const mensajes = (acciones: Accion[]) =>
  acciones.filter((a): a is Extract<Accion, { tipo: 'MENSAJE' }> => a.tipo === 'MENSAJE')

describe('identidad (§5.1)', () => {
  it('a un número sin identificar le pide el documento', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'hola' }), ctx({ identificada: false }))
    expect(r.estado).toBe('ESPERA_IDENTIDAD')
    expect(textos(r.acciones)).toContain('documento')
  })

  it('un documento válido se manda a validar contra el registro de personal', () => {
    const r = avanzar('ESPERA_IDENTIDAD', ev({ clase: 'TEXTO', texto: '1.234.567' }), ctx({ identificada: false }))
    expect(tipos(r.acciones)).toContain('IDENTIFICAR')
    const a = r.acciones.find((x) => x.tipo === 'IDENTIFICAR')
    // Se normaliza quitando puntos: nadie teclea un documento sin puntos.
    expect(a).toMatchObject({ documento: '1234567' })
  })

  it('al tercer intento fallido deriva a una persona', () => {
    const r = avanzar('ESPERA_IDENTIDAD', ev({ clase: 'TEXTO', texto: 'no soy un documento' }),
      ctx({ identificada: false, intentos: REINTENTOS }))
    expect(r.estado).toBe('ESPERA_AGENTE')
    expect(tipos(r.acciones)).toContain('DERIVAR_AGENTE')
  })

  it('NUNCA dice qué documentos sí existen', () => {
    const r = avanzar('ESPERA_IDENTIDAD', ev({ clase: 'TEXTO', texto: '99999999' }), ctx({ identificada: false }))
    // Lo único que puede hacer es mandarlo a validar; el texto que se le
    // responde al número no revela nada del registro de personal.
    expect(textos(r.acciones)).not.toMatch(/existe|encontr[eé].*\d/i)
  })

  it('un número bloqueado recibe UNA sola respuesta y después nada', () => {
    const primera = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'hola' }), ctx({ bloqueada: true }))
    expect(mensajes(primera.acciones)).toHaveLength(1)
    const segunda = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'hola' }),
      ctx({ bloqueada: true, datos: primera.datos }))
    expect(mensajes(segunda.acciones)).toHaveLength(0)
  })
})

describe('T1 · identificación del punto', () => {
  it('un código válido pide confirmación con botones, no abre nada solo', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'PUNTO K7M-4QX9' }),
      ctx({ visitaId: null, puntoBuscado: { existe: true, mismaSede: true, punto: PUNTO } }))
    expect(r.estado).toBe('PUNTO_IDENTIFICADO')
    // Abrir una visita cambia estado: pide confirmación explícita (§6).
    expect(tipos(r.acciones)).not.toContain('ABRIR_VISITA')
    expect(mensajes(r.acciones)[0].mensaje.tipo).toBe('BOTONES')
  })

  it('un código que no existe lo dice, con el código que se tecleó', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'punto zzz999' }),
      ctx({ visitaId: null, puntoBuscado: { existe: false, mismaSede: false, punto: null } }))
    expect(r.estado).toBe('SIN_VISITA')
    expect(textos(r.acciones)).toContain('ZZZ999')
  })

  it('un punto de otra sede ofrece reportarlo como novedad, no lo rechaza a secas', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'punto A1B2C3D' }),
      ctx({ visitaId: null, puntoBuscado: { existe: true, mismaSede: false, punto: PUNTO } }))
    expect(textos(r.acciones)).toMatch(/novedad/i)
  })

  it('con otra visita abierta ofrece las tres salidas', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'punto K7M4QX9' }),
      ctx({
        visitaId: null,
        puntoBuscado: { existe: true, mismaSede: true, punto: PUNTO },
        visitaAbiertaEnOtroPunto: { codigo: 'A1B2C3D' },
      }))
    const m = mensajes(r.acciones)[0].mensaje
    expect(m.tipo).toBe('BOTONES')
    if (m.tipo === 'BOTONES') expect(m.botones).toHaveLength(3)
  })

  it('un saludo responde con la lista de puntos del día', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'buenas' }), ctx({ visitaId: null }))
    expect(mensajes(r.acciones)[0].mensaje.tipo).toBe('LISTA')
  })

  it('sin puntos asignados lo dice y explica qué hacer', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'hola' }),
      ctx({ visitaId: null, puntosDelDia: [] }))
    expect(textos(r.acciones)).toMatch(/escane[aá]|c[oó]digo/i)
  })

  it('confirmar el botón SÍ abre la visita y pide la ubicación', () => {
    const r = avanzar('PUNTO_IDENTIFICADO', ev({ clase: 'BOTON', idRespuesta: 'punto:K7M4QX9:si' }),
      ctx({ visitaId: null }))
    expect(tipos(r.acciones)).toContain('ABRIR_VISITA')
    expect(mensajes(r.acciones).some((m) => m.mensaje.tipo === 'SOLICITUD_UBICACION')).toBe(true)
  })

  it('si falta un consentimiento, lo pide ANTES de pedir la ubicación', () => {
    const r = avanzar('PUNTO_IDENTIFICADO', ev({ clase: 'BOTON', idRespuesta: 'punto:K7M4QX9:si' }),
      ctx({ visitaId: null, consiente: { UBICACION: false, FOTOS: false, AUDIO: false, BIOMETRIA: false } }))
    expect(r.estado).toBe('ESPERA_CONSENTIMIENTO')
    expect(mensajes(r.acciones).some((m) => m.mensaje.tipo === 'SOLICITUD_UBICACION')).toBe(false)
  })
})

describe('§5.2 consentimientos', () => {
  it('pide los tres de la visita en orden y NUNCA el de biometría', () => {
    let estado: EstadoConversacion = 'ESPERA_CONSENTIMIENTO'
    let consiente = { UBICACION: false, FOTOS: false, AUDIO: false, BIOMETRIA: false }
    const pedidos: string[] = []
    for (let i = 0; i < 4; i++) {
      const r = avanzar(estado, ev({ clase: 'TEXTO', texto: 'que?' }), ctx({ consiente, visitaId: 'v-1' }))
      const m = mensajes(r.acciones)[0]
      if (!m) break
      const cuerpo = 'cuerpo' in m.mensaje ? m.mensaje.cuerpo : ''
      const cual = ['UBICACION', 'FOTOS', 'AUDIO', 'BIOMETR'].find((t) =>
        cuerpo.toLowerCase().includes(t.slice(0, 5).toLowerCase()))
      if (cual) pedidos.push(cual)
      const siguiente = (['UBICACION', 'FOTOS', 'AUDIO'] as const).find((t) => !consiente[t])
      if (!siguiente) break
      consiente = { ...consiente, [siguiente]: true }
      estado = r.estado
    }
    // La biometría es un dato SENSIBLE (art. 5 de la Ley 1581) y su
    // autorización va aparte, nunca junto con las otras tres.
    expect(pedidos).not.toContain('BIOMETR')
  })

  it('aceptar el último pasa a pedir la ubicación', () => {
    const r = avanzar('ESPERA_CONSENTIMIENTO', ev({ clase: 'BOTON', idRespuesta: 'consent:AUDIO:si' }),
      ctx({ consiente: { UBICACION: true, FOTOS: true, AUDIO: false, BIOMETRIA: false } }))
    expect(tipos(r.acciones)).toContain('CONSENTIMIENTO')
    expect(mensajes(r.acciones).some((m) => m.mensaje.tipo === 'SOLICITUD_UBICACION')).toBe(true)
  })

  it('DECIR NO no bloquea el trabajo: deja novedad y sigue', () => {
    const r = avanzar('ESPERA_CONSENTIMIENTO', ev({ clase: 'BOTON', idRespuesta: 'consent:UBICACION:no' }),
      ctx({ consiente: { UBICACION: false, FOTOS: true, AUDIO: true, BIOMETRIA: false } }))
    expect(tipos(r.acciones)).toContain('CONSENTIMIENTO')
    expect(tipos(r.acciones)).toContain('NOVEDAD')
    expect(r.acciones.find((a) => a.tipo === 'CONSENTIMIENTO')).toMatchObject({ otorgado: false })
    // Y se le dice qué implica, sin reprocharle nada.
    expect(textos(r.acciones)).toMatch(/supervisor/i)
  })

  it('«más información» manda el texto completo y no cuenta como respuesta', () => {
    const r = avanzar('ESPERA_CONSENTIMIENTO', ev({ clase: 'BOTON', idRespuesta: 'consent:FOTOS:info' }), ctx())
    expect(r.estado).toBe('ESPERA_CONSENTIMIENTO')
    expect(tipos(r.acciones)).not.toContain('CONSENTIMIENTO')
  })

  it('PRIVACIDAD muestra el estado y permite retirar', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEXTO', texto: 'privacidad' }), ctx())
    expect(mensajes(r.acciones)[0].mensaje.tipo).toBe('LISTA')
  })

  it('retirar un permiso lo registra como no otorgado', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'LISTA', idRespuesta: 'privacidad:retirar:AUDIO' }), ctx())
    expect(r.acciones.find((a) => a.tipo === 'CONSENTIMIENTO')).toMatchObject({ tipoDato: 'AUDIO', otorgado: false })
  })
})

describe('T2 · ubicación y geocerca', () => {
  const ubicacion = (dist: number, dentro: boolean) =>
    avanzar('PUNTO_IDENTIFICADO', ev({ clase: 'UBICACION', lat: 4.65, lng: -74.1 }),
      ctx({ geocerca: { distanciaM: dist, dentro, radioM: 75 } }))

  it('dentro de la geocerca valida y DICE LOS METROS', () => {
    const r = ubicacion(18, true)
    expect(r.estado).toBe('UBICACION_VALIDADA')
    // El número que se le responde es el que va a discutir con su supervisor.
    expect(textos(r.acciones)).toContain('18 m')
    expect(textos(r.acciones)).toContain('75 m')
  })

  it('fuera pero a menos del doble del radio ofrece reenviar, con la diferencia', () => {
    const r = ubicacion(142, false)
    expect(r.estado).toBe('PUNTO_IDENTIFICADO')
    expect(textos(r.acciones)).toContain('142 m')
    expect(textos(r.acciones)).toContain('67 m') // 142 − 75
  })

  it('«estoy en el punto» NO valida la geocerca: pasa con novedad y aviso', () => {
    const r = avanzar('PUNTO_IDENTIFICADO', ev({ clase: 'BOTON', idRespuesta: 'ubicacion:estoy' }),
      ctx({ geocerca: { distanciaM: 142, dentro: false, radioM: 75 } }))
    expect(r.estado).toBe('UBICACION_VALIDADA')
    expect(tipos(r.acciones)).toContain('NOVEDAD')
    expect(tipos(r.acciones)).toContain('AVISAR_SUPERVISOR')
    expect(r.datos.ubicacionForzada).toBe(true)
  })

  it('fuera por más del doble no abre la visita desde ahí', () => {
    const r = ubicacion(1240, false)
    expect(r.estado).toBe('ERROR_UBICACION')
    expect(textos(r.acciones)).toContain('1.240 m')
    expect(tipos(r.acciones)).toContain('AVISAR_SUPERVISOR')
  })

  it('un punto que no exige geocerca pasa sin discutir', () => {
    // Hay puntos en sótanos donde el GPS simplemente no sirve.
    const r = avanzar('PUNTO_IDENTIFICADO', ev({ clase: 'UBICACION', lat: 4.65, lng: -74.1 }),
      ctx({ punto: { ...PUNTO, exigeGeocerca: false }, geocerca: { distanciaM: 900, dentro: false, radioM: 75 } }))
    expect(r.estado).toBe('UBICACION_VALIDADA')
  })

  it('la ubicación se registra SIEMPRE, dentro o fuera', () => {
    for (const [d, dentro] of [[18, true], [142, false], [1240, false]] as const) {
      expect(tipos(ubicacion(d, dentro).acciones), `${d} m`).toContain('REGISTRAR_UBICACION')
    }
  })

  it('al tercer vencimiento sin ubicación pasa a error y avisa al supervisor', () => {
    const r = avanzar('PUNTO_IDENTIFICADO', ev({ clase: 'TEMPORIZADOR' }),
      ctx({ intentos: REINTENTOS, datos: { fase: 'VENCIMIENTO' } }))
    expect(r.estado).toBe('ERROR_UBICACION')
    expect(tipos(r.acciones)).toContain('AVISAR_SUPERVISOR')
  })

  it('el primer vencimiento manda un recordatorio, no un error', () => {
    const r = avanzar('PUNTO_IDENTIFICADO', ev({ clase: 'TEMPORIZADOR' }), ctx({ datos: { fase: 'RECORDATORIO' } }))
    expect(r.estado).toBe('PUNTO_IDENTIFICADO')
    expect(r.datos.fase).toBe('VENCIMIENTO')
    expect(mensajes(r.acciones)).toHaveLength(1)
  })
})

describe('T3 · foto de inicio', () => {
  it('una foto pasa a la lista de tareas', () => {
    const r = avanzar('UBICACION_VALIDADA', ev({ clase: 'IMAGEN', mediaId: 'm-1', mime: 'image/jpeg' }),
      ctx({ tareas: [tarea('t1'), tarea('t2')] }))
    expect(r.estado).toBe('FOTO_INICIO_OK')
    expect(tipos(r.acciones)).toContain('GUARDAR_MEDIO')
    expect(mensajes(r.acciones).some((m) => m.mensaje.tipo === 'LISTA')).toBe(true)
  })

  it('una imagen mandada COMO DOCUMENTO se acepta y se marca con EXIF', () => {
    // Es el único caso en que hay metadatos útiles: enviada como imagen,
    // WhatsApp le borra la geolocalización y el modelo del dispositivo.
    const r = avanzar('UBICACION_VALIDADA',
      ev({ clase: 'IMAGEN', mediaId: 'm-1', mime: 'image/jpeg', comoDocumento: true }),
      ctx({ tareas: [tarea('t1')] }))
    expect(r.estado).toBe('FOTO_INICIO_OK')
    expect(r.acciones.find((a) => a.tipo === 'GUARDAR_MEDIO')).toMatchObject({ comoDocumento: true })
  })

  it('un sticker no es una foto y NO gasta un intento', () => {
    const r = avanzar('UBICACION_VALIDADA', ev({ clase: 'STICKER', mediaId: 's-1' }), ctx({ intentos: 1 }))
    expect(r.estado).toBe('UBICACION_VALIDADA')
    expect(r.intentos).toBe(1)
    expect(textos(r.acciones)).toMatch(/no es una foto/i)
  })

  it('al tercer vencimiento ofrece seguir SIN foto', () => {
    const r = avanzar('UBICACION_VALIDADA', ev({ clase: 'TEMPORIZADOR' }),
      ctx({ intentos: REINTENTOS, datos: { fase: 'VENCIMIENTO' } }))
    expect(r.estado).toBe('ERROR_FOTO')
    const m = mensajes(r.acciones)[0].mensaje
    if (m.tipo === 'BOTONES') expect(m.botones.map((b) => b.id)).toContain('foto:sin')
  })

  it('«continuar sin foto» sigue con novedad, no cancela', () => {
    const r = avanzar('ERROR_FOTO', ev({ clase: 'BOTON', idRespuesta: 'foto:sin' }), ctx({ tareas: [tarea('t1')] }))
    expect(r.estado).toBe('FOTO_INICIO_OK')
    expect(tipos(r.acciones)).toContain('NOVEDAD')
  })
})

describe('T4 y T5 · tareas y ejecución', () => {
  it('elegir una tarea manda su instructivo y los tres botones', () => {
    const t = { ...tarea('t1'), instructivo: '1. Abrir la caja\n2. Revisar el sello' }
    const r = avanzar('FOTO_INICIO_OK', ev({ clase: 'LISTA', idRespuesta: 'tarea:t1' }), ctx({ tareas: [t] }))
    expect(r.estado).toBe('EN_EJECUCION')
    expect(textos(r.acciones)).toContain('Abrir la caja')
    expect(r.datos.tareaActual).toBe('t1')
  })

  it('«Hecha» contesta el paso y vuelve a la lista si quedan tareas', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'BOTON', idRespuesta: 'tarea:t1:hecha' }),
      ctx({ tareas: [tarea('t1'), tarea('t2')], datos: { tareaActual: 't1' } }))
    expect(tipos(r.acciones)).toContain('RESPONDER_PASO')
    expect(mensajes(r.acciones).some((m) => m.mensaje.tipo === 'LISTA')).toBe(true)
  })

  it('«Hecha» de la ÚLTIMA tarea pide la foto de cierre', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'BOTON', idRespuesta: 'tarea:t1:hecha' }),
      ctx({ tareas: [tarea('t1'), tarea('t2', 'HECHA')], datos: { tareaActual: 't1' } }))
    expect(r.datos.esperandoFotoFin).toBe(true)
    expect(textos(r.acciones)).toMatch(/terminado/i)
  })

  it('«No se pudo» pide el motivo con una lista corta', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'BOTON', idRespuesta: 'tarea:t1:nopudo' }),
      ctx({ tareas: [tarea('t1')] }))
    const m = mensajes(r.acciones)[0].mensaje
    expect(m.tipo).toBe('LISTA')
    if (m.tipo === 'LISTA') expect(m.secciones[0].filas).toHaveLength(4)
  })

  it('el motivo de la ÚLTIMA tarea deja marcado que se espera la foto de cierre', () => {
    // Si se pierde esa marca, la foto siguiente se archiva como foto de tarea y
    // la visita no llega nunca al resumen.
    const r = avanzar('EN_EJECUCION', ev({ clase: 'LISTA', idRespuesta: 'motivo:t1:Falta material' }),
      ctx({ tareas: [tarea('t1', 'PENDIENTE', 'CASILLA'), tarea('t2', 'HECHA')] }))
    expect(r.datos.esperandoFotoFin).toBe(true)
    expect(r.datos['motivo:t1']).toBe('Falta material')
    expect(tipos(r.acciones)).toContain('RESPONDER_PASO')
  })

  it('el motivo de una CASILLA la contesta NO con su motivo', () => {
    // No se omite: «no se pudo» en una casilla ES contestarla NO, y el CHECK de
    // F4 exige el motivo justo en ese caso.
    const r = avanzar('EN_EJECUCION', ev({ clase: 'LISTA', idRespuesta: 'motivo:t1:Falta material' }),
      ctx({ tareas: [tarea('t1', 'PENDIENTE', 'CASILLA'), tarea('t2')] }))
    expect(r.acciones.find((a) => a.tipo === 'RESPONDER_PASO')).toMatchObject({
      valor: { casilla: 'NO' }, motivo: 'Falta material',
    })
    expect(tipos(r.acciones)).toContain('NOVEDAD')
    expect(r.datos['motivo:t1']).toBe('Falta material')
  })

  it('el motivo de un paso que no es casilla lo omite con el motivo escrito', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'LISTA', idRespuesta: 'motivo:t1:Sin acceso' }),
      ctx({ tareas: [tarea('t1', 'PENDIENTE', 'FOTO'), tarea('t2')] }))
    expect(r.acciones.find((a) => a.tipo === 'RESPONDER_PASO')).toMatchObject({
      omitido: true, motivo: 'Sin acceso',
    })
  })

  it('«Hecha» solo se ofrece donde puede contestar el paso', () => {
    // Un paso de NUMERO necesita el número y uno de FOTO la foto: ofrecer
    // «Hecha» ahí sería un botón que la base va a rechazar.
    const casilla = avanzar('FOTO_INICIO_OK', ev({ clase: 'LISTA', idRespuesta: 'tarea:t1' }),
      ctx({ tareas: [tarea('t1', 'PENDIENTE', 'CASILLA')] }))
    const mc = mensajes(casilla.acciones).at(-1)!.mensaje
    if (mc.tipo === 'BOTONES') expect(mc.botones.map((b) => b.texto)).toContain('Hecha')

    const numero = avanzar('FOTO_INICIO_OK', ev({ clase: 'LISTA', idRespuesta: 'tarea:t1' }),
      ctx({ tareas: [tarea('t1', 'PENDIENTE', 'NUMERO')] }))
    const mn = mensajes(numero.acciones).at(-1)!.mensaje
    if (mn.tipo === 'BOTONES') expect(mn.botones.map((b) => b.texto)).not.toContain('Hecha')
    // Y le dice qué mandar en vez de dejarlo adivinando.
    if (mn.tipo === 'BOTONES') expect(mn.cuerpo).toMatch(/valor/i)
  })

  it('un botón «Hecha» viejo de una tarea ya contestada no la re-contesta', () => {
    // Pisar la respuesta borraría la medición que ya estaba guardada.
    const r = avanzar('EN_EJECUCION', ev({ clase: 'BOTON', idRespuesta: 'tarea:t1:hecha' }),
      ctx({ tareas: [tarea('t1', 'HECHA', 'NUMERO'), tarea('t2')] }))
    expect(tipos(r.acciones)).not.toContain('RESPONDER_PASO')
  })

  it('la foto de CIERRE no se archiva como foto de tarea', () => {
    // Si se confundieran, la persona mandaría la foto final y el bot le diría
    // «foto guardada», dejándola esperando para siempre.
    const r = avanzar('EN_EJECUCION', ev({ clase: 'IMAGEN', mediaId: 'm-fin' }),
      ctx({ tareas: [tarea('t1', 'HECHA')], datos: { esperandoFotoFin: true } }))
    expect(r.estado).toBe('RESUMEN')
    expect(r.acciones.find((a) => a.tipo === 'GUARDAR_MEDIO')).toMatchObject({ hito: 'FOTO_FIN' })
    expect(r.datos.esperandoFotoFin).toBe(false)
    expect(typeof r.datos.resumenTexto).toBe('string')
  })

  it('esperando la foto de cierre, otra cosa la vuelve a pedir y no muestra tareas', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEXTO', texto: 'listo' }),
      ctx({ tareas: [tarea('t1', 'HECHA')], datos: { esperandoFotoFin: true } }))
    expect(r.estado).toBe('EN_EJECUCION')
    expect(mensajes(r.acciones).every((m) => m.mensaje.tipo === 'TEXTO')).toBe(true)
    expect(textos(r.acciones)).toMatch(/terminado/i)
  })

  it('una medición se CONFIRMA antes de guardarla', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEXTO', texto: 'presión 12 bar' }),
      ctx({ tareas: [tarea('t1', 'PENDIENTE', 'NUMERO')], datos: { tareaActual: 't1' } }))
    // Un número mal leído en un reporte es un número que alguien va a discutir.
    expect(tipos(r.acciones)).not.toContain('RESPONDER_PASO')
    expect(textos(r.acciones)).toContain('12 bar')
    expect(r.datos.medicionPendiente).toEqual({ numero: 12, unidad: 'bar' })
  })

  it('confirmar la medición la guarda', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'BOTON', idRespuesta: 'confirmar:medicion:si' }),
      ctx({ tareas: [tarea('t1', 'PENDIENTE', 'NUMERO')], datos: { tareaActual: 't1', medicionPendiente: { numero: 12, unidad: 'bar' } } }))
    expect(r.acciones.find((a) => a.tipo === 'RESPONDER_PASO')).toMatchObject({ valor: { numero: 12, unidad: 'bar' } })
  })

  it('un texto suelto se guarda como nota de la tarea en curso', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEXTO', texto: 'el sello está roto' }),
      ctx({ tareas: [tarea('t1', 'PENDIENTE', 'TEXTO')], datos: { tareaActual: 't1' } }))
    expect(r.acciones.find((a) => a.tipo === 'RESPONDER_PASO')).toMatchObject({ valor: { texto: 'el sello está roto' } })
  })

  it('una foto en ejecución se archiva contra la tarea en curso', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'IMAGEN', mediaId: 'm-2' }),
      ctx({ tareas: [tarea('t1')], datos: { tareaActual: 't1' } }))
    expect(r.acciones.find((a) => a.tipo === 'GUARDAR_MEDIO')).toMatchObject({ hito: 'TAREA', tareaId: 't1' })
  })

  it('una nota de voz se guarda y se manda a transcribir', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'AUDIO', mediaId: 'a-1', voz: true }),
      ctx({ tareas: [tarea('t1')], datos: { tareaActual: 't1' } }))
    expect(tipos(r.acciones)).toContain('GUARDAR_MEDIO')
    expect(tipos(r.acciones)).toContain('TRANSCRIBIR')
  })

  it('SIN consentimiento de audio se GUARDA el archivo pero no se transcribe', () => {
    // El audio es lo que la persona mandó y es evidencia: no se descarta. Lo
    // que no se hace es pasarlo por un tercero sin permiso.
    const r = avanzar('EN_EJECUCION', ev({ clase: 'AUDIO', mediaId: 'a-1', voz: true }),
      ctx({
        tareas: [tarea('t1')],
        consiente: { UBICACION: true, FOTOS: true, AUDIO: false, BIOMETRIA: false },
        datos: { tareaActual: 't1' },
      }))
    expect(tipos(r.acciones)).toContain('GUARDAR_MEDIO')
    expect(tipos(r.acciones)).not.toContain('TRANSCRIBIR')
  })

  it('el reloj de ejecución tiene piso de 45 y techo de 180 minutos', () => {
    const corto = avanzar('EN_EJECUCION', ev({ clase: 'IMAGEN', mediaId: 'm' }),
      ctx({ punto: { ...PUNTO, duracionMin: 5 }, tareas: [tarea('t1')] }))
    expect(corto.esperaSegundos).toBe(RELOJES.ejecucionPiso)
    const largo = avanzar('EN_EJECUCION', ev({ clase: 'IMAGEN', mediaId: 'm' }),
      ctx({ punto: { ...PUNTO, duracionMin: 500 }, tareas: [tarea('t1')] }))
    expect(largo.esperaSegundos).toBe(RELOJES.ejecucionTecho)
  })

  it('SIGUIENTE en ejecución pide la foto de cierre', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEXTO', texto: 'ya terminé' }), ctx({ tareas: [tarea('t1')] }))
    expect(r.datos.esperandoFotoFin).toBe(true)
  })

  it('al vencerse la ejecución la visita EXPIRA en borrador, con aviso', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEMPORIZADOR' }),
      ctx({ tareas: [tarea('t1')], datos: { fase: 'VENCIMIENTO' } }))
    expect(r.estado).toBe('EXPIRADA')
    expect(r.acciones.find((a) => a.tipo === 'CERRAR_VISITA')).toMatchObject({ borrador: true })
    expect(tipos(r.acciones)).toContain('AVISAR_SUPERVISOR')
  })
})

describe('T7, T8 y T9 · resumen, confirmación y cierre', () => {
  it('confirmar cierra la visita y NADA más espera de la persona', () => {
    const r = avanzar('RESUMEN', ev({ clase: 'BOTON', idRespuesta: 'resumen:confirmar' }),
      ctx({ tareas: [tarea('t1', 'HECHA')], fotos: 2 }))
    expect(r.estado).toBe('CONFIRMADA')
    expect(tipos(r.acciones)).toContain('CERRAR_VISITA')
  })

  it('corregir vuelve a EN_EJECUCION y lo deja elegir qué', () => {
    const r = avanzar('RESUMEN', ev({ clase: 'BOTON', idRespuesta: 'resumen:corregir' }), ctx())
    expect(r.estado).toBe('EN_EJECUCION')
    expect(mensajes(r.acciones)[0].mensaje.tipo).toBe('LISTA')
  })

  it('el primer vencimiento del resumen lo repite UNA vez y reinicia el reloj', () => {
    const r = avanzar('RESUMEN', ev({ clase: 'TEMPORIZADOR' }), ctx())
    expect(r.estado).toBe('RESUMEN')
    expect(r.datos.resumenRepetido).toBe(true)
    expect(r.esperaSegundos).toBe(RELOJES.resumenSegundo)
  })

  it('EL SISTEMA NUNCA CONFIRMA EN NOMBRE DE LA PERSONA', () => {
    // Al segundo vencimiento el reporte queda en BORRADOR y lo confirma un
    // supervisor desde la consola. Esta es la prueba que no se puede relajar.
    const r = avanzar('RESUMEN', ev({ clase: 'TEMPORIZADOR' }), ctx({ datos: { resumenRepetido: true } }))
    expect(r.estado).toBe('EXPIRADA')
    expect(r.estado).not.toBe('CONFIRMADA')
    expect(r.acciones.find((a) => a.tipo === 'CERRAR_VISITA')).toMatchObject({ borrador: true })
    expect(r.datos.pendienteConfirmacion).toBe(true)
  })

  it('si el cierre falla, la confirmación NO se pierde', () => {
    const r = avanzar('CONFIRMADA', ev({ clase: 'TEMPORIZADOR' }), ctx())
    expect(r.estado).toBe('CONFIRMADA')
    expect(tipos(r.acciones)).toContain('CERRAR_VISITA')
  })

  it('al tercer vencimiento de la foto de cierre pasa a RESUMEN igual, con novedad', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEMPORIZADOR' }),
      ctx({ intentos: REINTENTOS, tareas: [tarea('t1', 'HECHA')], datos: { esperandoFotoFin: true, fase: 'VENCIMIENTO' } }))
    expect(r.estado).toBe('RESUMEN')
    expect(tipos(r.acciones)).toContain('NOVEDAD')
    // Y queda guardado el texto exacto que la persona vio.
    expect(typeof r.datos.resumenTexto).toBe('string')
  })
})

describe('§6 comandos', () => {
  const casos: [string, string][] = [
    ['ayuda', 'CMD_AYUDA'],
    ['AYUDA', 'CMD_AYUDA'],
    ['¿me ayudás?', 'CMD_AYUDA'],
    ['mis puntos', 'CMD_MIS_PUNTOS'],
    ['MIS PUNTOS', 'CMD_MIS_PUNTOS'],
    ['privacidad', 'CMD_PRIVACIDAD'],
    ['hablar con supervisor', 'CMD_SUPERVISOR'],
    ['novedad', 'CMD_NOVEDAD'],
  ]
  for (const [texto, disparador] of casos) {
    it(`«${texto}» funciona en cualquier estado`, () => {
      for (const estado of ['SIN_VISITA', 'EN_EJECUCION', 'RESUMEN', 'ERROR_UBICACION'] as EstadoConversacion[]) {
        const r = avanzar(estado, ev({ clase: 'TEXTO', texto }), ctx({ tareas: [tarea('t1')] }))
        expect(r.disparador, `${texto} en ${estado}`).toBe(disparador)
      }
    })
  }

  it('CANCELAR pide confirmación, no cancela de una', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEXTO', texto: 'cancelar' }), ctx())
    expect(r.estado).toBe('EN_EJECUCION')
    expect(tipos(r.acciones)).not.toContain('ANULAR_VISITA')
  })

  it('confirmar la cancelación anula la visita y dice que lo enviado no se borra', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'BOTON', idRespuesta: 'cancelar:si' }), ctx())
    expect(r.estado).toBe('CANCELADA')
    expect(tipos(r.acciones)).toContain('ANULAR_VISITA')
    expect(textos(r.acciones)).toMatch(/qued[oó] guardado/i)
  })

  it('CREAR QR sin permiso lo dice y no hace nada', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'crear qr' }), ctx({ puedeCrearQr: false }))
    expect(r.disparador).toBe('CMD_CREAR_QR_SIN_PERMISO')
    expect(textos(r.acciones)).toMatch(/permiso/i)
  })

  it('CREAR QR con permiso arranca el flujo', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'crear qr' }), ctx({ puedeCrearQr: true }))
    expect(r.disparador).toBe('CMD_CREAR_QR')
  })

  it('un id de botón desconocido NO se adivina', () => {
    // Lo que llega por el webhook es dato del exterior, no una orden.
    const r = avanzar('RESUMEN', ev({ clase: 'BOTON', idRespuesta: 'inventado:peligroso:si' }), ctx())
    expect(tipos(r.acciones)).not.toContain('CERRAR_VISITA')
    expect(tipos(r.acciones)).not.toContain('ANULAR_VISITA')
  })
})

describe('§7 desconexión laboral (Ley 2191 de 2022)', () => {
  it('AVISO_FIN_JORNADA ofrece cerrar, esperar o dejarlo para mañana', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'AVISO_FIN_JORNADA' }), ctx({ tareas: [tarea('t1')] }))
    const m = mensajes(r.acciones)[0].mensaje
    expect(m.tipo).toBe('BOTONES')
    if (m.tipo === 'BOTONES') expect(m.botones).toHaveLength(3)
  })

  it('al fin del turno la visita NO se cancela: pasa a espera en borrador', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'FIN_JORNADA' }), ctx({ tareas: [tarea('t1')] }))
    expect(r.estado).toBe('EN_ESPERA_FUERA_DE_JORNADA')
    expect(r.estado).not.toBe('CANCELADA')
    expect(r.acciones.find((a) => a.tipo === 'CERRAR_VISITA')).toMatchObject({ borrador: true })
    expect(tipos(r.acciones)).toContain('AVISAR_SUPERVISOR')
  })

  it('después del fin de jornada el bot DEJA DE ESCRIBIR', () => {
    // Ni recordatorios, ni plantillas, ni «no olvides». Nada. Un mensaje del
    // bot a esa hora es exactamente lo que el art. 3 prohíbe.
    const fin = avanzar('EN_EJECUCION', ev({ clase: 'FIN_JORNADA' }), ctx({ tareas: [tarea('t1')] }))
    const despues = avanzar(fin.estado, ev({ clase: 'AVISO_FIN_JORNADA' }), ctx({ datos: fin.datos }))
    expect(mensajes(despues.acciones)).toHaveLength(0)
  })

  it('si la persona escribe por su cuenta, el bot responde y avisa UNA vez', () => {
    const r = avanzar('EN_ESPERA_FUERA_DE_JORNADA', ev({ clase: 'TEXTO', texto: 'quiero cerrar el punto' }),
      ctx({ jornadaAbierta: false, tareas: [tarea('t1')] }))
    expect(textos(r.acciones)).toMatch(/termin[oó] tu turno/i)
    expect(r.datos.fueraDeJornada).toBe(true)
    // La segunda vez ya no avisa: avisar dos veces es insistir.
    const segunda = avanzar('EN_ESPERA_FUERA_DE_JORNADA', ev({ clase: 'TEXTO', texto: 'listo' }),
      ctx({ jornadaAbierta: false, tareas: [tarea('t1')], datos: r.datos }))
    expect(textos(segunda.acciones)).not.toMatch(/termin[oó] tu turno/i)
  })

  it('a las 48 horas se cierra sola y no se le vuelve a escribir', () => {
    const r = avanzar('EN_ESPERA_FUERA_DE_JORNADA', ev({ clase: 'TEMPORIZADOR' }), ctx())
    expect(r.estado).toBe('CERRADA_CON_NOVEDAD')
    expect(mensajes(r.acciones)).toHaveLength(0)
    expect(r.esperaSegundos).toBeNull()
  })

  it('un mensaje del bot va marcado BOT y una respuesta va marcada RESPUESTA', () => {
    // Es lo que el portero usa para aplicar la jornada: si todo fuera
    // RESPUESTA, el bloqueo no haría nada.
    const porTemporizador = avanzar('UBICACION_VALIDADA', ev({ clase: 'TEMPORIZADOR' }),
      ctx({ datos: { fase: 'RECORDATORIO' } }))
    expect(mensajes(porTemporizador.acciones).every((m) => m.iniciadoPor === 'BOT')).toBe(true)

    const porMensaje = avanzar('UBICACION_VALIDADA', ev({ clase: 'IMAGEN', mediaId: 'm' }),
      ctx({ tareas: [tarea('t1')] }))
    expect(mensajes(porMensaje.acciones).every((m) => m.iniciadoPor === 'RESPUESTA')).toBe(true)
  })
})

describe('invariantes de toda la máquina', () => {
  const ESTADOS: EstadoConversacion[] = [
    'SIN_VISITA', 'PUNTO_IDENTIFICADO', 'UBICACION_VALIDADA', 'FOTO_INICIO_OK',
    'EN_EJECUCION', 'FOTO_FIN_OK', 'RESUMEN', 'CONFIRMADA', 'CERRADA',
    'ESPERA_IDENTIDAD', 'ESPERA_CONSENTIMIENTO', 'ERROR_UBICACION', 'ERROR_FOTO',
    'ESPERA_AGENTE', 'EN_ESPERA_FUERA_DE_JORNADA', 'EXPIRADA', 'CANCELADA', 'CERRADA_CON_NOVEDAD',
  ]
  const CLASES: EventoMaquina['clase'][] = [
    'TEXTO', 'BOTON', 'LISTA', 'UBICACION', 'IMAGEN', 'AUDIO', 'VIDEO', 'DOCUMENTO',
    'STICKER', 'CONTACTO', 'REACCION', 'NO_SOPORTADO', 'TEMPORIZADOR',
    'AVISO_FIN_JORNADA', 'FIN_JORNADA',
  ]

  it('ningún par (estado, evento) lanza una excepción', () => {
    // El webhook es público: un payload raro no puede tumbar el trabajador y
    // dejar la cola atascada para todos.
    for (const estado of ESTADOS) {
      for (const clase of CLASES) {
        for (const extra of [{}, { texto: 'cualquier cosa' }, { idRespuesta: 'x:y:z' }, { mediaId: 'm' }, { lat: 4.6, lng: -74.1 }]) {
          expect(() => avanzar(estado, ev({ clase, ...extra }), ctx({ tareas: [tarea('t1')] })),
            `${estado} + ${clase} + ${JSON.stringify(extra)}`).not.toThrow()
        }
      }
    }
  })

  it('todo resultado devuelve un estado del dominio y un entero de intentos', () => {
    for (const estado of ESTADOS) {
      for (const clase of CLASES) {
        const r = avanzar(estado, ev({ clase, texto: 'hola' }), ctx({ tareas: [tarea('t1')] }))
        expect(ESTADOS, `${estado} + ${clase}`).toContain(r.estado)
        expect(Number.isInteger(r.intentos)).toBe(true)
        expect(r.intentos).toBeGreaterThanOrEqual(0)
        expect(r.disparador.length).toBeGreaterThan(0)
      }
    }
  })

  it('los estados finales no dejan temporizador colgado', () => {
    for (const estado of ['CERRADA', 'CERRADA_CON_NOVEDAD', 'CANCELADA'] as EstadoConversacion[]) {
      const r = avanzar(estado, ev({ clase: 'TEMPORIZADOR' }), ctx())
      expect(r.esperaSegundos, estado).toBeNull()
    }
  })

  it('un número bloqueado nunca produce una acción que escriba en la visita', () => {
    for (const estado of ESTADOS) {
      for (const clase of CLASES) {
        const r = avanzar(estado, ev({ clase, texto: 'confirmar', idRespuesta: 'resumen:confirmar' }),
          ctx({ bloqueada: true }))
        expect(tipos(r.acciones).filter((t) => t !== 'MENSAJE'), `${estado} + ${clase}`).toHaveLength(0)
      }
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// F10 · El menú configurable y la próxima ubicación
// ─────────────────────────────────────────────────────────────────────────────
// El menú es de datos, no de código: lo configura cada contrato en
// `crm_menu_opciones` y la máquina solo lo pinta y despacha la opción tocada.
// Lo que estas pruebas fijan es que una opción nunca haga algo que el bot no
// sepa hacer, y que la próxima parada NO se invente cuando no hay ruta.
describe('F10 · menú del bot', () => {
  const MENU: MenuOpcion[] = [
    { id: 'm1', etiqueta: 'Mi próximo punto', accion: 'PROXIMA_UBICACION' },
    { id: 'm2', etiqueta: 'Mis puntos de hoy', accion: 'MIS_PUNTOS' },
    { id: 'm3', etiqueta: 'Portería', accion: 'TEXTO', texto: 'Extensión 101.' },
    { id: 'm4', etiqueta: 'Ver mi mapa', accion: 'MI_MAPA' },
  ]
  const PARADA = {
    estado: 'PARADA' as const,
    codigo: 'K7M4QX9',
    nombre: 'Cuarto de bombas',
    comoLlegar: 'Al fondo del sótano',
    piso: '-1',
  }

  it('MENÚ responde con una lista de las opciones configuradas', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'menú' }), ctx({ menu: MENU }))
    const m = r.acciones[0]
    expect(m.tipo).toBe('MENSAJE')
    expect(m.tipo === 'MENSAJE' && m.mensaje.tipo).toBe('LISTA')
    const filas = m.tipo === 'MENSAJE' && m.mensaje.tipo === 'LISTA'
      ? m.mensaje.secciones.flatMap((s) => s.filas) : []
    expect(filas.map((f) => f.id)).toEqual(['menu:m1', 'menu:m2', 'menu:m3', 'menu:m4'])
  })

  it('sin menú configurado responde la ayuda, no una lista vacía', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'MENU' }), ctx({ menu: [] }))
    expect(r.disparador).toBe('CMD_MENU_VACIO')
    const m = r.acciones[0]
    expect(m.tipo === 'MENSAJE' && m.mensaje.tipo).toBe('TEXTO')
  })

  it('tocar la opción de próxima ubicación da el punto que trajo el motor', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'LISTA', idRespuesta: 'menu:m1' }),
      ctx({ menu: MENU, proximaParada: PARADA }))
    expect(r.disparador).toBe('MENU_PROXIMA_UBICACION')
    const texto = r.acciones[0].tipo === 'MENSAJE' && r.acciones[0].mensaje.tipo === 'TEXTO'
      ? r.acciones[0].mensaje.texto : ''
    expect(texto).toContain('K7M4QX9')
    expect(texto).toContain('Cuarto de bombas')
    // §4.3: si falta la foto o la referencia, el bot usa lo que haya.
    expect(texto).toContain('Al fondo del sótano')
  })

  it('una opción de texto fijo contesta ese texto y NADA más', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'LISTA', idRespuesta: 'menu:m3' }), ctx({ menu: MENU }))
    expect(tipos(r.acciones)).toEqual(['MENSAJE'])
    const texto = r.acciones[0].tipo === 'MENSAJE' && r.acciones[0].mensaje.tipo === 'TEXTO'
      ? r.acciones[0].mensaje.texto : ''
    expect(texto).toBe('Extensión 101.')
  })

  it('una opción que el canal todavía no hace lo DICE, no se queda muda', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'LISTA', idRespuesta: 'menu:m4' }), ctx({ menu: MENU }))
    expect(r.disparador).toBe('MENU_OPCION_SIN_CANAL')
    expect(r.acciones).toHaveLength(1)
  })

  it('un id de opción que ya no existe vuelve a mostrar el menú', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'LISTA', idRespuesta: 'menu:borrada' }), ctx({ menu: MENU }))
    expect(r.disparador).toBe('MENU_OPCION_VIEJA')
    const m = r.acciones[0]
    expect(m.tipo === 'MENSAJE' && m.mensaje.tipo).toBe('LISTA')
  })

  it('ninguna opción del menú escribe en la visita: solo responde', () => {
    for (const o of MENU) {
      const r = avanzar('EN_EJECUCION', ev({ clase: 'LISTA', idRespuesta: `menu:${o.id}` }),
        ctx({ menu: MENU, proximaParada: PARADA }))
      const escrituras = tipos(r.acciones).filter(
        (t) => !['MENSAJE', 'DERIVAR_AGENTE', 'AVISAR_SUPERVISOR', 'CONSENTIMIENTO'].includes(t),
      )
      expect(escrituras, o.accion).toHaveLength(0)
    }
  })

  it('el menú no cambia el estado de la conversación', () => {
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEXTO', texto: 'opciones' }), ctx({ menu: MENU }))
    expect(r.estado).toBe('EN_EJECUCION')
  })
})

describe('F10 · próxima ubicación', () => {
  it('sin ruta de hoy lo dice y no inventa un punto', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'a dónde sigo' }),
      ctx({ proximaParada: { estado: 'SIN_RUTA' } }))
    expect(r.disparador).toBe('CMD_PROXIMA_UBICACION')
    const texto = r.acciones[0].tipo === 'MENSAJE' && r.acciones[0].mensaje.tipo === 'TEXTO'
      ? r.acciones[0].mensaje.texto : ''
    expect(texto.toLowerCase()).toContain('no tenés una ruta')
    expect(texto).not.toContain('undefined')
  })

  it('con la ruta terminada felicita en vez de mandar a un punto', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'próximo punto' }),
      ctx({ proximaParada: { estado: 'RUTA_TERMINADA' } }))
    const texto = r.acciones[0].tipo === 'MENSAJE' && r.acciones[0].mensaje.tipo === 'TEXTO'
      ? r.acciones[0].mensaje.texto : ''
    expect(texto.toLowerCase()).toContain('no te quedan paradas')
  })

  it('si el motor no la trajo, se comporta como «sin ruta» y no revienta', () => {
    const r = avanzar('SIN_VISITA', ev({ clase: 'TEXTO', texto: 'mi próximo punto' }),
      ctx({ proximaParada: null }))
    expect(r.acciones).toHaveLength(1)
    expect(r.estado).toBe('SIN_VISITA')
  })

  it('«siguiente punto» sigue siendo terminar el punto, no la próxima parada', () => {
    // Las dos frases se parecen y significan cosas distintas: una pide la
    // siguiente parada, la otra dice «ya terminé acá».
    const r = avanzar('EN_EJECUCION', ev({ clase: 'TEXTO', texto: 'siguiente punto' }), ctx())
    expect(r.disparador).toBe('CMD_SIGUIENTE')
  })
})

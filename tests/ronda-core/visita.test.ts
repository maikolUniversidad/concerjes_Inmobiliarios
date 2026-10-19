// El núcleo de ejecución de la visita: las mismas reglas que la base, pero en
// el dispositivo, para que la pantalla avise antes de mandar y para que la
// visita se pueda completar sin señal (ADR-02 §2.9).
//
// Lo que estas pruebas cuidan es la COINCIDENCIA con la migración
// 20261019000040: si el núcleo y la base no piden lo mismo, la PWA pediría
// cosas que el servidor no exige, o dejaría cerrar algo que el servidor va a
// marcar incompleto cuando ya no hay nadie mirando el celular.
import { describe, expect, it } from 'vitest'
import {
  abrirVisita, adjuntarEvidencia, cerrarVisita, clasificarEntrada, codigoDeEscaneo,
  demoraSincronizacionSegundos, desfaseSegundos, distanciaMetros, evaluarGeocerca,
  faltantesCierre, firmar, intentsDeVisita, pasosVisibles, progreso, responderPaso,
  validarEvidencia, type EvidenciaLocal, type Paso, type VisitaLocal,
} from '../../packages/ronda-core/src'

const paso = (p: Partial<Paso> & Pick<Paso, 'id' | 'orden' | 'tipo' | 'titulo'>): Paso => ({
  obligatorio: true, config: {}, ...p,
})

const PUNTO = { lat: 4.65, lng: -74.05, geocercaMetros: 30, exigeGeocerca: true }

const abrir = (pasos: Paso[], extra: Partial<Parameters<typeof abrirVisita>[0]> = {}) => {
  const r = abrirVisita({
    id: 'v1', puntoId: 'p1', puntoNombre: 'Baño piso 3', plantillaId: 'pl1',
    pasos, personaId: 'per1', identidadMetodo: 'CUENTA', aperturaModo: 'QR',
    geocerca: evaluarGeocerca(PUNTO, { lat: 4.65, lng: -74.05, precisionMetros: 8 }),
    ...extra,
  })
  if (!r.ok) throw new Error(r.error)
  return r.visita
}

describe('geocerca', () => {
  it('a 120 m de un punto con geocerca de 30 queda fuera y exige motivo', () => {
    // ~120 m al norte: 0,001079° de latitud.
    const g = evaluarGeocerca(PUNTO, { lat: 4.651079, lng: -74.05, precisionMetros: 10 })
    expect(g.dentro).toBe(false)
    expect(Math.round(g.distanciaMetros as number)).toBeGreaterThan(110)
    expect(Math.round(g.distanciaMetros as number)).toBeLessThan(130)
    expect(g.exigeMotivo).toBe(true)
    expect(g.pedirReintento).toBe(true)
    expect(g.mensaje).toContain('geocerca es de 30 m')
  })

  it('con precisión PEOR que el radio la lectura queda dudosa, no rechazada', () => {
    const g = evaluarGeocerca(PUNTO, { lat: 4.65, lng: -74.05, precisionMetros: 80 })
    expect(g.dentro).toBe(true)       // la distancia dice que sí…
    expect(g.dudosa).toBe(true)       // …pero no se puede confiar
    expect(g.pedirReintento).toBe(true)
    expect(g.exigeMotivo).toBe(true)
    expect(g.mensaje).toContain('±80 m')
  })

  it('sin lectura de GPS no hay nada que justificar, pero se pide reintentar', () => {
    const g = evaluarGeocerca(PUNTO, { lat: null, lng: null })
    expect(g.dentro).toBeNull()
    expect(g.sinGps).toBe(true)
    expect(g.exigeMotivo).toBe(false)
    expect(g.pedirReintento).toBe(true)
  })

  it('la distancia es la de la base (haversine)', () => {
    expect(distanciaMetros(4.65, -74.05, 4.65, -74.05)).toBe(0)
    expect(Math.round(distanciaMetros(4.65, -74.05, 4.6509, -74.05))).toBe(100)
  })

  it('abrir fuera de cerca sin motivo falla, como el CHECK de la base', () => {
    const fuera = evaluarGeocerca(PUNTO, { lat: 4.651079, lng: -74.05, precisionMetros: 10 })
    const r = abrirVisita({
      id: 'v1', puntoId: 'p1', puntoNombre: 'x', plantillaId: 'pl1', pasos: [],
      personaId: 'per1', identidadMetodo: 'CUENTA', aperturaModo: 'QR', geocerca: fuera,
    })
    expect(r.ok).toBe(false)
    const con = abrirVisita({
      id: 'v1', puntoId: 'p1', puntoNombre: 'x', plantillaId: 'pl1', pasos: [],
      personaId: 'per1', identidadMetodo: 'CUENTA', aperturaModo: 'QR', geocerca: fuera,
      motivoFueraGeocerca: 'El portón del sótano no abre desde adentro',
    })
    expect(con.ok).toBe(true)
  })
})

describe('respuestas', () => {
  it('una casilla en NO sin motivo se rechaza', () => {
    const v = abrir([paso({ id: 's1', orden: 1, tipo: 'CASILLA', titulo: '¿Está limpio?' })])
    const no = responderPaso(v, 's1', { casilla: 'NO' })
    expect(no.ok).toBe(false)
    expect(no.ok === false && no.error).toContain('motivo')
    const si = responderPaso(v, 's1', { casilla: 'NO' }, { motivo: 'No había agua' })
    expect(si.ok).toBe(true)
  })

  it('si la plantilla no exige motivo, un NO pasa solo', () => {
    const v = abrir([paso({
      id: 's1', orden: 1, tipo: 'CASILLA', titulo: '¿Hay papel?',
      config: { motivo_obligatorio_si_no: false },
    })])
    expect(responderPaso(v, 's1', { casilla: 'NO' }).ok).toBe(true)
  })

  it('el número respeta el rango del paso', () => {
    const v = abrir([paso({
      id: 's1', orden: 1, tipo: 'NUMERO', titulo: 'Lectura', config: { min: 0, max: 100 },
    })])
    expect(responderPaso(v, 's1', { numero: 120 }).ok).toBe(false)
    expect(responderPaso(v, 's1', { numero: 42 }).ok).toBe(true)
  })

  it('un paso saltado exige el motivo de la omisión', () => {
    const v = abrir([paso({ id: 's1', orden: 1, tipo: 'TEXTO', titulo: 'Observación' })])
    expect(responderPaso(v, 's1', {}, { omitido: true }).ok).toBe(false)
    expect(responderPaso(v, 's1', {}, { omitido: true, omisionMotivo: 'Zona cerrada' }).ok).toBe(true)
  })

  it('los pasos condicionales solo se muestran cuando su condición se cumple', () => {
    const v0 = abrir([
      paso({ id: 's1', orden: 1, tipo: 'CASILLA', titulo: '¿Todo bien?' }),
      paso({ id: 's2', orden: 2, tipo: 'TEXTO', titulo: '¿Qué pasó?',
             condicion_paso_id: 's1', condicion_valor: 'NO' }),
    ])
    expect(pasosVisibles(v0).map((p) => p.id)).toEqual(['s1'])
    const r = responderPaso(v0, 's1', { casilla: 'NO' }, { motivo: 'La llave gotea' })
    if (!r.ok) throw new Error(r.error)
    expect(pasosVisibles(r.visita).map((p) => p.id)).toEqual(['s1', 's2'])
    // Y un condicional que no aplica no puede dejar la visita incompleta.
    expect(faltantesCierre(v0).map((f) => f.pasoId)).toEqual(['s1'])
  })
})

describe('evidencia', () => {
  const sha = 'a'.repeat(64)
  const foto = (extra: Partial<EvidenciaLocal> = {}): EvidenciaLocal => ({
    id: 'e1', pasoId: 's1', tipo: 'FOTO', origen: 'CAMARA_VIVO', sha256: sha, ...extra,
  })

  it('un paso de solo cámara en vivo no acepta un archivo de la galería', () => {
    const p = paso({ id: 's1', orden: 1, tipo: 'FOTO', titulo: 'Antes',
                     config: { min: 1, max: 2, solo_camara_vivo: true } })
    expect(validarEvidencia(p, foto({ origen: 'GALERIA' }))).toContain('galería')
    expect(validarEvidencia(p, foto())).toBeNull()
  })

  it('un archivo sin sha256 no se acepta: sin huella no es prueba', () => {
    const p = paso({ id: 's1', orden: 1, tipo: 'FOTO', titulo: 'Antes', config: { min: 1 } })
    expect(validarEvidencia(p, foto({ sha256: 'corto' }))).toContain('huella')
  })

  it('no se pasa del máximo de fotos del paso', () => {
    const v = abrir([paso({ id: 's1', orden: 1, tipo: 'FOTO', titulo: 'Antes',
                            config: { min: 1, max: 1 } })])
    const r1 = adjuntarEvidencia(v, foto())
    if (!r1.ok) throw new Error(r1.error)
    const r2 = adjuntarEvidencia(r1.visita, foto({ id: 'e2' }))
    expect(r2.ok).toBe(false)
  })

  it('faltan fotos → la visita no está completa', () => {
    const v = abrir([paso({ id: 's1', orden: 1, tipo: 'FOTO', titulo: 'Antes',
                            config: { min: 2, max: 3 } })])
    const r = responderPaso(v, 's1', {})
    expect(r.ok).toBe(false)     // el paso de foto se contesta CON la foto
    const con = adjuntarEvidencia(v, foto())
    if (!con.ok) throw new Error(con.error)
    expect(faltantesCierre(con.visita)[0].falta).toBe('SIN_RESPONDER')
  })
})

describe('cierre', () => {
  const pasosDemo = [
    paso({ id: 's1', orden: 1, tipo: 'CASILLA', titulo: '¿Está limpio?' }),
    paso({ id: 's2', orden: 2, tipo: 'TEXTO', titulo: 'Observación', obligatorio: false }),
  ]

  it('una visita completa queda COMPLETADA', () => {
    const v = abrir(pasosDemo)
    const r = responderPaso(v, 's1', { casilla: 'SI' })
    if (!r.ok) throw new Error(r.error)
    const c = cerrarVisita(r.visita)
    expect(c.ok).toBe(true)
    expect(c.ok && c.visita.estado).toBe('COMPLETADA')
    expect(progreso(r.visita).porcentaje).toBe(50)
  })

  it('con algo pendiente NO se bloquea el cierre, pero se exige el motivo', () => {
    const v = abrir(pasosDemo)
    const sinMotivo = cerrarVisita(v)
    expect(sinMotivo.ok).toBe(false)
    expect(sinMotivo.faltantes?.[0].falta).toBe('SIN_RESPONDER')
    const con = cerrarVisita(v, { motivoIncompleta: 'Se cortó la luz en el piso' })
    expect(con.ok).toBe(true)
    expect(con.ok && con.visita.estado).toBe('INCOMPLETA')
  })

  it('la plantilla que exige firma no cierra completa sin la del trabajador', () => {
    const v = abrir(pasosDemo, { exigeFirma: true })
    const r = responderPaso(v, 's1', { casilla: 'SI' })
    if (!r.ok) throw new Error(r.error)
    expect(faltantesCierre(r.visita).map((f) => f.falta)).toEqual(['FIRMA_TRABAJADOR'])
    const f = firmar(r.visita, { quien: 'TRABAJADOR', metodo: 'TRAZO', trazo: 'data:image/png;base64,AA' })
    if (!f.ok) throw new Error(f.error)
    expect(faltantesCierre(f.visita)).toHaveLength(0)
  })
})

describe('intents de la cola', () => {
  it('la visita va primero, el cierre de último y la evidencia antes del cierre', () => {
    const v0 = abrir([
      paso({ id: 's1', orden: 1, tipo: 'FOTO', titulo: 'Antes', config: { min: 1, max: 2 } }),
    ])
    const conFoto = adjuntarEvidencia(v0, {
      id: 'e1', pasoId: 's1', tipo: 'FOTO', origen: 'CAMARA_VIVO', sha256: 'b'.repeat(64),
      rutaArchivo: 'v1/e1.jpg',
    })
    if (!conFoto.ok) throw new Error(conFoto.error)
    const resp = responderPaso(conFoto.visita, 's1', {})
    if (!resp.ok) throw new Error(resp.error)
    const cerrada = cerrarVisita(resp.visita)
    if (!cerrada.ok) throw new Error('no cerró')

    const kinds = intentsDeVisita(cerrada.visita, { personaId: 'per1' }).map((i) => i.kind)
    expect(kinds[0]).toBe('ronda:visita')
    expect(kinds[kinds.length - 1]).toBe('ronda:cierre')
    expect(kinds.indexOf('ronda:evidencia')).toBeLessThan(kinds.indexOf('ronda:cierre'))
    expect(kinds.indexOf('ronda:respuesta')).toBeLessThan(kinds.indexOf('ronda:evidencia'))
  })

  it('una visita abierta todavía no manda cierre', () => {
    const v = abrir([paso({ id: 's1', orden: 1, tipo: 'CASILLA', titulo: '¿Listo?' })])
    const kinds = intentsDeVisita(v, { personaId: 'per1' }).map((i) => i.kind)
    expect(kinds).toEqual(['ronda:visita'])
  })

  it('el payload lleva la hora del DISPOSITIVO y la sesión de campo', () => {
    const v = abrir([], { identidadMetodo: 'ENLACE_PIN', sesionId: 'ses1', offline: true })
    const [intent] = intentsDeVisita(v, { personaId: 'per1', sesionId: 'ses1' })
    expect(intent.payload.p_offline).toBe(true)
    expect(intent.payload.p_sesion).toBe('ses1')
    expect(typeof intent.payload.p_inicio_dispositivo).toBe('string')
  })
})

describe('relojes y códigos', () => {
  it('el desfase es con la hora del servidor; la demora, lo que esperó en la cola', () => {
    expect(desfaseSegundos('2026-10-19T12:00:00Z', '2026-10-19T12:02:00Z')).toBe(120)
    expect(demoraSincronizacionSegundos('2026-10-19T02:00:00Z', '2026-10-19T07:00:00Z')).toBe(18000)
    // Nunca negativa: un celular adelantado no "llega antes".
    expect(demoraSincronizacionSegundos('2026-10-19T08:00:00Z', '2026-10-19T07:00:00Z')).toBe(0)
  })

  it('distingue un token de placa de un código tecleado', () => {
    expect(clasificarEntrada('1K7M4QX9T01A9F3C1B7E2').modo).toBe('QR')
    expect(clasificarEntrada('K7M4-QX9T').modo).toBe('MANUAL')
    expect(clasificarEntrada('hola').modo).toBeNull()
  })

  it('saca el código de la URL que devuelve el lector de QR', () => {
    expect(codigoDeEscaneo('https://app.example.com/q/1K7M4QX9T01A9F3C1B7E2'))
      .toBe('1K7M4QX9T01A9F3C1B7E2')
    expect(codigoDeEscaneo('k7m4-qx9t')).toBe('K7M4QX9T')
  })
})

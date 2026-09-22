import { describe, it, expect } from 'vitest'
import { recorteCarnet } from '@/lib/registro/foto'
import { incrustarFoto, limpiarHtml, resolverMarcadores } from '@/lib/documentos/html'
import {
  htmlResultadoPrueba, perfilDeRespuestas, duracionMinutos, type DatosResultadoPrueba, type PreguntaResultado,
} from '@/lib/ats/resultado-prueba'

describe('foto de perfil tipo carné', () => {
  it('recorta vertical 3:4 y centrado desde la cámara (4:3 horizontal)', () => {
    expect(recorteCarnet(1280, 960)).toEqual({ sx: 280, sy: 0, sw: 720, sh: 960 })
    expect(recorteCarnet(640, 480)).toEqual({ sx: 140, sy: 0, sw: 360, sh: 480 })
  })

  it('una foto ya 3:4 queda completa y una muy alta se recorta arriba y abajo', () => {
    expect(recorteCarnet(3024, 4032)).toEqual({ sx: 0, sy: 0, sw: 3024, sh: 4032 })
    expect(recorteCarnet(1080, 1920)).toEqual({ sx: 0, sy: 240, sw: 1080, sh: 1440 })
  })

  it('al generar, la foto queda incrustada en el marcador y sobrevive a la limpieza', () => {
    const src = 'data:image/jpeg;base64,QUJD'
    const html = incrustarFoto('<td>{{FOTO_CARNET}}</td>', src)
    expect(html).toBe(`<td><img class="foto-carnet" alt="Foto" src="${src}" /></td>`)
    expect(limpiarHtml(html)).toBe(html)
    // Sin foto el marcador sigue ahí para resolverse al mostrar (recuadro o URL).
    expect(incrustarFoto('{{FOTO_CARNET}}', null)).toBe('{{FOTO_CARNET}}')
  })
})

describe('resultado imprimible de las pruebas', () => {
  const conocimientos: PreguntaResultado[] = [
    { id: 'q1', orden: 1, enunciado: '¿Qué se usa para <limpiar> vidrios?', opciones: [{ clave: 'A', texto: 'Paño' }, { clave: 'B', texto: 'Lija' }], respuesta_correcta: 'A' },
    { id: 'q2', orden: 2, enunciado: 'Pregunta dos', opciones: [{ clave: 'A', texto: 'Uno' }, { clave: 'C', texto: 'Tres' }], respuesta_correcta: 'C' },
    { id: 'q3', orden: 3, enunciado: 'Pregunta tres', opciones: [{ clave: 'A', texto: 'Sí' }], respuesta_correcta: 'A' },
  ]
  const base: DatosResultadoPrueba = {
    empresa: { razon_social: 'Empresa de ejemplo', nit: '900.000.000-1' },
    candidato: { nombre: 'LAURA MARCELA RÍOS PEÑA', tipo_documento: 'CC', numero_documento: '1000123456', cargo: 'OPERARIO ASEO', ciudad: 'Bogotá D.C.' },
    prueba: { nombre: 'Prueba de conocimientos operativos', tipo: 'CONOCIMIENTOS', tiempo_limite_min: 10, requiere_firma: true },
    preguntas: conocimientos,
    intento: {
      estado: 'FINALIZADA', iniciado_at: '2026-09-22T14:00:00Z', finalizado_at: '2026-09-22T14:07:30Z',
      respuestas: { q1: 'A', q2: 'A' }, puntaje: 1, puntaje_max: 3,
      firma_nombre: 'LAURA MARCELA RÍOS PEÑA', firma_documento: '1000123456', ip: '203.0.113.7', hash: 'abc123',
    },
    ahora: new Date('2026-09-22T15:00:00Z'),
  }

  it('conocimientos: puntaje, correcta/incorrecta/sin responder, firma y evidencia', () => {
    const html = htmlResultadoPrueba(base)
    expect(html).toContain('Puntaje: 1 / 3')
    expect(html).toContain('✓ Correcta')
    expect(html).toContain('✗ Incorrecta')
    expect(html).toContain('Sin responder')
    expect(html).toContain('&lt;limpiar&gt;')
    expect(html).toContain('(coincide con el registro)')
    expect(html).toContain('203.0.113.7')
    expect(html).toContain('8 min')
    expect(html).toContain('{{FOTO_CARNET}}')
    const final = resolverMarcadores(limpiarHtml(html), { fotoUrl: 'https://ejemplo.com/foto.jpg' })
    expect(final).not.toMatch(/\{\{|\}\}/)
    expect(final).toContain('src="https://ejemplo.com/foto.jpg"')
  })

  it('aptitud: perfil A/B por dimensión, sin puntaje', () => {
    const preguntas: PreguntaResultado[] = [
      { id: 'a1', orden: 1, enunciado: 'Ante un derrame…', opciones: [{ clave: 'A', texto: 'Calma' }, { clave: 'B', texto: 'Apoyo' }], dimension: 'Seguridad' },
      { id: 'a2', orden: 2, enunciado: 'Protocolos…', opciones: [{ clave: 'A', texto: 'Al pie de la letra' }, { clave: 'B', texto: 'Me adapto' }], dimension: 'Norma' },
      { id: 'a3', orden: 3, enunciado: 'Seguridad…', opciones: [{ clave: 'A', texto: 'Protocolos' }, { clave: 'B', texto: 'Equipo' }], dimension: 'Seguridad' },
    ]
    const respuestas = { a1: 'A', a2: 'B', a3: 'A' }
    expect(perfilDeRespuestas(preguntas, respuestas)).toEqual({ Seguridad: { A: 2, B: 0 }, Norma: { A: 0, B: 1 } })
    const html = htmlResultadoPrueba({
      ...base,
      prueba: { nombre: 'Prueba de aptitud', tipo: 'APTITUD', tiempo_limite_min: null, requiere_firma: false },
      preguntas,
      intento: { estado: 'FINALIZADA', iniciado_at: base.intento.iniciado_at, finalizado_at: base.intento.finalizado_at, respuestas, perfil: null },
    })
    expect(html).toContain('Perfil por dimensión')
    expect(html).not.toContain('Puntaje:')
    expect(html).toContain('B. Me adapto')
    expect(html).toContain('Sin límite')
  })

  it('duración en minutos', () => {
    expect(duracionMinutos('2026-09-22T14:00:00Z', '2026-09-22T14:00:20Z')).toBe(1)
    expect(duracionMinutos('2026-09-22T14:00:00Z', '2026-09-22T14:09:40Z')).toBe(10)
    expect(duracionMinutos(null, '2026-09-22T14:00:00Z')).toBeNull()
  })
})

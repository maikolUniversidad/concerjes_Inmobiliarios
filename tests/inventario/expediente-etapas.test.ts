import { describe, it, expect } from 'vitest'
import { ETAPAS, estadoEtapa, etapaDeEstado, requisitosEtapa, type ResumenExpediente } from '@/lib/ats/etapas'
import { BANDEJAS } from '@/lib/ats/fases'
import { mesesEntre, rangoTiempo, MOTIVOS_RETIRO, TIEMPOS_LABORADOS } from '@/lib/ats/opciones'
import { cortesDePagina, cortesEntreRenglones } from '@/lib/documentos/paquete'
import { itemsFaltantes, planPaquete, type FuentesPaquete } from '@/lib/documentos/paquete-plan'

describe('etapas del expediente = bandejas de Postulaciones', () => {
  it('mismos nombres y orden que las bandejas (Contratados va en Contratación, Descartados en Historial)', () => {
    const porBandeja = BANDEJAS.map((b) => ETAPAS.find((e) => e.bandejas.includes(b.key))?.key)
    expect(porBandeja).toEqual(['postulacion', 'evaluacion', 'seguridad', 'examenes', 'contratacion', 'contratacion', 'historial'])
    for (const e of ETAPAS.filter((x) => x.n)) {
      expect(BANDEJAS.find((b) => b.key === e.bandejas[0])?.label).toBe(e.label)
    }
  })

  it('abre en la etapa de la fase del candidato', () => {
    expect(etapaDeEstado('POSTULADO')).toBe('postulacion')
    expect(etapaDeEstado('EN_PRUEBAS')).toBe('postulacion')
    expect(etapaDeEstado('EN_VERIFICACION')).toBe('postulacion')
    expect(etapaDeEstado('ENTREVISTA')).toBe('evaluacion')
    expect(etapaDeEstado('SEGURIDAD')).toBe('seguridad')
    expect(etapaDeEstado('EXAMEN_MEDICO')).toBe('examenes')
    expect(etapaDeEstado('APTO')).toBe('examenes')
    expect(etapaDeEstado('PRESELECCIONADO')).toBe('contratacion')
    expect(etapaDeEstado('CONTRATADO')).toBe('contratacion')
    expect(etapaDeEstado('RECHAZADO')).toBe('historial')
    expect(etapaDeEstado(null)).toBe('postulacion')
  })

  it('marca las etapas hechas, la actual y las que vienen', () => {
    expect(estadoEtapa('postulacion', 'SEGURIDAD')).toBe('hecha')
    expect(estadoEtapa('seguridad', 'SEGURIDAD')).toBe('actual')
    expect(estadoEtapa('examenes', 'SEGURIDAD')).toBe('pendiente')
    expect(estadoEtapa('contratacion', 'CONTRATADO')).toBe('hecha')
    expect(estadoEtapa('evaluacion', 'RECHAZADO')).toBe('cerrada')
  })

  it('lista qué falta en cada etapa', () => {
    const r: ResumenExpediente = {
      docsFaltantesRegistro: ['Cédula'], docsPorRevisar: 2, pruebasPresentadas: 1, pruebasTotal: 2, centroCosto: false,
      entrevista: 'PENDIENTE', referenciasVerificadas: 2, referenciasTotal: 4, seguridadRegistrada: true, antecedentes: 'SIN_NOVEDAD',
      remitidoIps: true, conceptoCargado: false, apto: false, foto: true, docsFaltantesVinculacion: [], contrato: true,
      generados: 5, porFirmar: 2, contratado: false,
    }
    const post = requisitosEtapa('postulacion', r)
    expect(post.filter((x) => x.ok)).toEqual([])
    expect(post[0].detalle).toBe('Faltan: Cédula')
    expect(post[2].detalle).toBe('1 de 2 presentadas')
    expect(requisitosEtapa('evaluacion', r).map((x) => x.ok)).toEqual([true, false, true])
    expect(requisitosEtapa('seguridad', r).every((x) => x.ok)).toBe(true)
    expect(requisitosEtapa('examenes', r).map((x) => x.ok)).toEqual([true, false, false])
    const contr = requisitosEtapa('contratacion', r)
    expect(contr.find((x) => x.texto.startsWith('Formatos'))?.detalle).toBe('2 por firmar')
    expect(requisitosEtapa('historial', r)).toEqual([])
  })
})

describe('opciones de la entrevista y del formulario', () => {
  it('tiempo laborado por rangos a partir de las fechas', () => {
    expect(mesesEntre('2024-01-15', '2024-03-14')).toBe(1)
    expect(mesesEntre('2024-01-15', '2024-03-15')).toBe(2)
    expect(mesesEntre('2025-01-01', '2024-01-01')).toBeNull()
    expect(rangoTiempo('2025-01-01', '2025-02-01')).toBe(TIEMPOS_LABORADOS[0])
    expect(rangoTiempo('2023-08-01', '2024-08-02')).toBe('De 1 a 2 años')
    expect(rangoTiempo('2015-01-01', '2024-01-01')).toBe('Más de 5 años')
    expect(rangoTiempo(null, '2024-01-01')).toBe('')
    expect(MOTIVOS_RETIRO).toContain('Renuncia voluntaria')
  })
})

describe('paquete de contratación', () => {
  it('corta las páginas al empezar cada hoja y en el último renglón que cabe', () => {
    // Documento de 2000 px, página de 900: hoja nueva en 1200; renglones cada 100 px.
    const bordes = Array.from({ length: 20 }, (_, i) => (i + 1) * 100 - 10)
    expect(cortesDePagina(2000, 900, [0, 1200], bordes)).toEqual([[0, 890], [890, 1200], [1200, 2000]])
    // Sin renglones que sirvan corta en el límite de la página.
    expect(cortesDePagina(1000, 400, [], [])).toEqual([[0, 400], [400, 800], [800, 1000]])
    expect(cortesDePagina(300, 900, [], [100])).toEqual([[0, 300]])
  })

  it('corta en la mitad del espacio entre renglones; los trozos de un mismo renglón cuentan como uno', () => {
    expect(cortesEntreRenglones([
      { top: 0, bottom: 16 }, { top: 1, bottom: 17 },   // un renglón con negrita y texto normal
      { top: 20, bottom: 36 }, { top: 48, bottom: 64 },   // renglón siguiente y otro párrafo
    ])).toEqual([19, 42])
  })

  const fuentes: FuentesPaquete = {
    plantillas: [{ codigo: 'HOJA_VIDA', nombre: 'Hoja de vida' }, { codigo: 'CONTRATO_OBRA_LABOR', nombre: 'Contrato' }],
    tipos: [{ id: 't1', codigo: 'CEDULA', nombre: 'Cédula' }, { id: 't2', codigo: 'DIPLOMA', nombre: 'Diploma' }],
    generados: [
      { id: 'g1', codigo_plantilla: 'HOJA_VIDA', nombre: 'Hoja de vida', estado: 'ANULADO', archivo_firmado_path: null, generado_at: '2026-09-01' },
      { id: 'g2', codigo_plantilla: 'HOJA_VIDA', nombre: 'Hoja de vida', estado: 'FIRMADO', archivo_firmado_path: null, generado_at: '2026-09-02' },
      { id: 'g3', codigo_plantilla: 'CONTRATO_OBRA_LABOR', nombre: 'Contrato', estado: 'FIRMADO', archivo_firmado_path: 'c/FIRMADOS/g3.jpg', generado_at: '2026-09-03' },
    ],
    docs: [
      { id: 'd2', tipo_documental_id: 't1', estado: 'VALIDADO', orden: 2, storage_path: 'c/CEDULA/b.jpg', nombre_original: 'reverso.jpg', mime: 'image/jpeg' },
      { id: 'd1', tipo_documental_id: 't1', estado: 'CARGADO', orden: 1, storage_path: 'c/CEDULA/a.jpg', nombre_original: 'frente.jpg', mime: 'image/jpeg' },
      { id: 'd3', tipo_documental_id: 't1', estado: 'RECHAZADO', orden: 3, storage_path: 'c/CEDULA/x.jpg', nombre_original: 'borrosa.jpg', mime: 'image/jpeg' },
    ],
    intentos: [{ id: 'i1', estado: 'FINALIZADA', prueba: { tipo: 'APTITUD' } }, { id: 'i2', estado: 'EN_CURSO', prueba: { tipo: 'CONOCIMIENTOS' } }],
  }

  it('decide de dónde sale cada parte y salta lo que no hay', () => {
    const plan = planPaquete([
      { tipo: 'plantilla', codigo: 'HOJA_VIDA' }, { tipo: 'documento', codigo: 'CEDULA' }, { tipo: 'documento', codigo: 'DIPLOMA' },
      { tipo: 'plantilla', codigo: 'CONTRATO_OBRA_LABOR' }, { tipo: 'prueba', codigo: 'APTITUD' }, { tipo: 'prueba', codigo: 'CONOCIMIENTOS' },
    ], fuentes)
    expect(plan[0].fuente).toEqual({ clase: 'generado', id: 'g2' })
    expect(plan[1].fuente).toEqual({ clase: 'archivos', archivos: [
      { path: 'c/CEDULA/a.jpg', nombre: 'frente.jpg', mime: 'image/jpeg' },
      { path: 'c/CEDULA/b.jpg', nombre: 'reverso.jpg', mime: 'image/jpeg' },
    ] })
    expect(plan[2]).toMatchObject({ titulo: 'Diploma', fuente: null, texto: 'No está cargado' })
    expect(plan[3].fuente).toEqual({ clase: 'escaneado', path: 'c/FIRMADOS/g3.jpg', nombre: 'Contrato.jpg' })
    expect(plan[4].fuente).toEqual({ clase: 'prueba', intentoId: 'i1' })
    expect(plan[5].fuente).toBeNull()
  })

  it('ofrece para agregar solo lo que no está en el orden', () => {
    const faltan = itemsFaltantes([{ tipo: 'documento', codigo: 'CEDULA' }], fuentes)
    expect(faltan.map((x) => `${x.tipo}:${x.codigo}`)).toEqual([
      'plantilla:HOJA_VIDA', 'plantilla:CONTRATO_OBRA_LABOR', 'documento:DIPLOMA', 'prueba:APTITUD', 'prueba:CONOCIMIENTOS',
    ])
  })
})

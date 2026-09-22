import { describe, it, expect } from 'vitest'
import {
  FASES, FLUJO, BANDEJAS, faseMeta, siguienteFase, documentosFaltantes, estadoPorMotivo, semaforoDias, tipoAplicaCargo,
  type TipoDocRegla,
} from '@/lib/ats/fases'
import { COLUMNAS_WO, filaWO, fechaWO, estadoCivilWO, libretaWO, type DatosWO } from '@/lib/ats/wo'
import { contratoVacio, CLAUSULAS_ADICIONALES_POR_DEFECTO } from '@/lib/ats/contrato'

describe('fases del proceso', () => {
  it('cada fase del flujo tiene metadatos y bandeja', () => {
    for (const k of FLUJO) {
      const m = faseMeta(k)
      expect(m.label.length, k).toBeGreaterThan(0)
      expect(BANDEJAS.some((b) => b.key === m.bandeja), k).toBe(true)
    }
    expect(new Set(FASES.map((f) => f.key)).size).toBe(FASES.length)
  })

  it('APROBAR avanza en el orden del proceso real', () => {
    expect(siguienteFase('POSTULADO')).toBe('EN_PRUEBAS')
    expect(siguienteFase('EN_VERIFICACION')).toBe('ENTREVISTA')
    expect(siguienteFase('SEGURIDAD')).toBe('EXAMEN_MEDICO')
    expect(siguienteFase('APTO')).toBe('PRESELECCIONADO')
    expect(siguienteFase('ACTIVO')).toBeNull()
    expect(siguienteFase('RECHAZADO')).toBeNull()
  })

  it('el motivo de descarte decide el estado de cierre', () => {
    expect(estadoPorMotivo('DESISTIMIENTO')).toBe('DESISTIO')
    expect(estadoPorMotivo('TOXICOLOGIA')).toBe('NO_APTO')
    expect(estadoPorMotivo('SEGURIDAD_AAA')).toBe('RECHAZADO')
  })

  it('semáforo de días en fase', () => {
    expect(semaforoDias(2).color).toContain('green')
    expect(semaforoDias(5).color).toContain('amber')
    expect(semaforoDias(12).color).toContain('red')
  })
})

describe('documentos obligatorios antes de mover', () => {
  const tipos: TipoDocRegla[] = [
    { id: 'ced', codigo: 'CEDULA', nombre: 'Cédula', obligatorio: true, min_archivos: 2, ola: 1, aplica_si: null },
    { id: 'rnmc', codigo: 'ANT_RNMC', nombre: 'RNMC', obligatorio: true, min_archivos: 1, ola: 1, aplica_si: null },
    { id: 'alim', codigo: 'CERT_ALIMENTOS', nombre: 'Alimentos', obligatorio: true, min_archivos: 1, ola: 1, aplica_si: { 'cargo.requiere_manipulacion_alimentos': true } },
    { id: 'apt', codigo: 'CONCEPTO_APTITUD', nombre: 'Concepto médico', obligatorio: true, min_archivos: 1, ola: 2, aplica_si: null },
    { id: 'eps', codigo: 'AFIL_EPS', nombre: 'Afiliación EPS', obligatorio: true, min_archivos: 1, ola: 2, aplica_si: null },
    { id: 'opc', codigo: 'CURSOS', nombre: 'Cursos', obligatorio: false, min_archivos: 0, ola: 1, aplica_si: null },
  ]

  it('en las primeras fases no exige nada', () => {
    expect(documentosFaltantes('EN_VERIFICACION', tipos, [], {})).toEqual([])
  })

  it('desde la entrevista exige los obligatorios del registro, contando archivos no rechazados', () => {
    const docs = [
      { tipo_documental_id: 'ced', estado: 'VALIDADO' },
      { tipo_documental_id: 'ced', estado: 'RECHAZADO' },
      { tipo_documental_id: 'rnmc', estado: 'CARGADO' },
    ]
    expect(documentosFaltantes('ENTREVISTA', tipos, docs, {})).toEqual(['Cédula'])
  })

  it('los condicionales dependen del cargo', () => {
    const docs = [{ tipo_documental_id: 'ced', estado: 'CARGADO' }, { tipo_documental_id: 'ced', estado: 'CARGADO' }, { tipo_documental_id: 'rnmc', estado: 'CARGADO' }]
    expect(documentosFaltantes('ENTREVISTA', tipos, docs, { requiere_manipulacion_alimentos: true })).toEqual(['Alimentos'])
    expect(tipoAplicaCargo(tipos[2], { requiere_manipulacion_alimentos: false })).toBe(false)
  })

  it('APTO exige el concepto médico y CONTRATADO los de vinculación', () => {
    const docs = [{ tipo_documental_id: 'ced', estado: 'CARGADO' }, { tipo_documental_id: 'ced', estado: 'CARGADO' }, { tipo_documental_id: 'rnmc', estado: 'CARGADO' }]
    expect(documentosFaltantes('APTO', tipos, docs, {})).toEqual(['Concepto médico'])
    expect(documentosFaltantes('CONTRATADO', tipos, docs, {})).toEqual(['Concepto médico', 'Afiliación EPS'])
  })
})

describe('fila para nómina (WO)', () => {
  const base: DatosWO = {
    tipo_documento: 'CC', numero_documento: '1000000099', ciudad_expedicion: 'Bogota D.C.', primer_nombre: 'JUAN', segundo_nombre: 'CARLOS',
    primer_apellido: 'PÉREZ', segundo_apellido: 'GÓMEZ', tipo_contrato: 'OBRA_LABOR', fecha_ingreso: '2026-07-17', area: 'Produccion',
    clase_salario: 'Salario Inferior al Minimo', empresa: 'CONSERJES INMOBILIARIOS LTDA', cargo: 'OPERARIO ASEO', salario: 650000,
    centro_costo: 'CLIENTE EJEMPLO', clasificacion_dian: 'Normal', fecha_nacimiento: '1993-06-24', ciudad_residencia: 'Bogota D.C.',
    tipo_direccion: 'Casa', direccion: 'Calle 10 # 20-30', telefono: '3000000099', email: 'juan.perez@ejemplo.com', numero_hijos: 0,
    estado_civil: 'Soltero(a)', declarante: false, dotacion: false, tipo_cuenta: 'Ahorros', numero_cuenta: '00000000099', banco: 'AV VILLAS',
    tipo_sena: '', fecha_fin_periodo_prueba: '', fecha_fin_contrato: '', arl: 'ARL SEGUROS DE VIDA COLPATRIA', fecha_afil_arl: '2026-07-17',
    tarifa_arl: 1.044, eps: 'SALUD TOTAL', fecha_afil_eps: '2026-07-17', afp: 'PORVENIR', fecha_afil_afp: '2026-07-17',
    cesantias: 'PORVENIR S.A. AFPC', fecha_afil_cesantias: '2026-07-17', caja: 'CCF COMPENSAR', fecha_afil_caja: '2026-07-17',
    codigo_centro_costo: '', libreta_militar: '1ª clase', genero: 'Masculino', ciudad_wo: 'BOGOTA', depto_wo: 'BOGOTA D.E.',
    tipo_cotizante: 'Dependiente', subtipo_cotizante: 'Ninguno',
  }

  it('tiene las 55 columnas del exporte real, en orden', () => {
    expect(COLUMNAS_WO.length).toBe(55)
    expect(filaWO(base).length).toBe(55)
  })

  it('reproduce la fila del exporte WO de ejemplo', () => {
    const f = filaWO(base)
    expect(f.slice(0, 9)).toEqual(['CC', '1000000099', 'Bogota D.C.', 'JUAN', 'CARLOS', 'PÉREZ', 'GÓMEZ', 'Labor Contratada', '17/07/2026'])
    expect(f[17]).toBe(-1)
    expect(f[21]).toBe(0)
    expect(f[29]).toBe('Soltero')
    expect(f[40]).toBe('1.044')
    expect(f[50]).toBe('Primera Clase')
    expect(f[52]).toBe('Ciudad: BOGOTA Depto: BOGOTA D.E.')
  })

  it('conversiones de formato', () => {
    expect(fechaWO('2026-08-22')).toBe('22/08/2026')
    expect(fechaWO(null)).toBe('')
    expect(estadoCivilWO('Unión libre')).toBe('Union Libre')
    expect(libretaWO('No aplica')).toBe('N/A')
  })
})

describe('contrato por defecto', () => {
  it('toma la minuta vigente', () => {
    const k = contratoVacio({ cargoId: 'c', centroId: null, smlv: 1623500, hoy: '2026-09-22' })
    expect(k.tipo_contrato).toBe('OBRA_LABOR')
    expect(k.periodo_prueba_dias).toBe(60)
    expect(k.clausulas_adicionales).toEqual(CLAUSULAS_ADICIONALES_POR_DEFECTO)
    expect(k.salario).toBe(1623500)
  })
})

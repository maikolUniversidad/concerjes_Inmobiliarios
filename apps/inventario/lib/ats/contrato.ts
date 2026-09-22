// Valores por defecto del contrato de trabajo, tomados de la minuta vigente
// ("CONTRATO INDIVIDUAL DE TRABAJO POR LA DURACIÓN DE UNA OBRA O LABOR
// DETERMINADA") y del contrato firmado de ejemplo.

export const CLAUSULAS_ADICIONALES_POR_DEFECTO = [
  'Sin perjuicio de las cláusulas sexta y séptima del presente contrato, este se dará por terminado en caso de que el usuario solicite su cambio o traslado por mal servicio, o por cualquier otro motivo.',
  'Las partes acuerdan estipular un salario uniforme de conformidad con el Art. 170 C.S.T., en el cual se establece que cuando el trabajo por equipo implique la rotación sucesiva de turnos diurnos y nocturnos, las partes pueden estipular salarios uniformes para el trabajo diurno y nocturno, siempre que estos salarios, comparados con los de actividades idénticas o similares en horas diurnas, compensen los recargos legales.',
  'Las partes de común acuerdo y de conformidad con el art. 128 del C.S.T., modificado por el art. 15 de la Ley 50/90, en concordancia con el art. 17 de la Ley 344/96, acuerdan que los pagos realizados por este concepto no tendrán naturaleza salarial y/o prestacional, y por lo tanto no se tendrán en cuenta como factor salarial para la liquidación de acreencias laborales, ni para el pago de aportes parafiscales y cotizaciones a la seguridad social, de conformidad con los Arts. 15 y 16 de la Ley 50/90, en concordancia con el Art. 17 de la Ley 344/96.',
]

export const SALARIO_TEXTO_POR_DEFECTO = 'Mínimo Legal Vigente más Auxilio de Transporte y Recargos de Ley'
export const PERIODO_PAGO_POR_DEFECTO = 'MES VENCIDO (QUINTO DÍA HÁBIL DE CADA MES)'

export const MODALIDADES_CONTRATO = [
  { value: 'OBRA_LABOR', label: 'Obra o labor determinada' },
  { value: 'TERMINO_FIJO', label: 'Término fijo' },
  { value: 'INDEFINIDO', label: 'Término indefinido' },
]

export const CLASES_SALARIO = ['Normal', 'Salario Inferior al Minimo', 'Salario Integral']

export interface ContratoForm {
  id?: string
  codigo?: string
  estado?: string
  tipo_contrato: string
  cargo_id: string
  centro_costo_id: string
  fecha_inicio_labores: string
  salario: number
  salario_texto: string
  clase_salario: string
  incluye_auxilio_transporte: boolean
  periodo_pago: string
  lugar_labores: string
  ciudad_contratacion: string
  contrato_servicio: string
  periodo_prueba_dias: number
  fecha_fin_contrato: string
  modalidad_jornada: string
  arl_id: string
  tarifa_arl: number
  ciudad_firma: string
  fecha_firma: string
  testigo1_nombre: string
  testigo1_documento: string
  testigo2_nombre: string
  testigo2_documento: string
  clausulas_adicionales: string[]
  observaciones: string
}

export function contratoVacio(p: { cargoId?: string | null; centroId?: string | null; smlv?: number | null; hoy: string; arlId?: string | null }): ContratoForm {
  return {
    tipo_contrato: 'OBRA_LABOR',
    cargo_id: p.cargoId ?? '',
    centro_costo_id: p.centroId ?? '',
    fecha_inicio_labores: p.hoy,
    salario: Number(p.smlv ?? 0),
    salario_texto: SALARIO_TEXTO_POR_DEFECTO,
    clase_salario: 'Normal',
    incluye_auxilio_transporte: true,
    periodo_pago: PERIODO_PAGO_POR_DEFECTO,
    lugar_labores: 'BOGOTÁ',
    ciudad_contratacion: 'BOGOTÁ',
    contrato_servicio: '',
    periodo_prueba_dias: 60,
    fecha_fin_contrato: '',
    modalidad_jornada: 'JORNADA MÁXIMA LEGAL',
    arl_id: p.arlId ?? '',
    tarifa_arl: 1.044,
    ciudad_firma: 'BOGOTÁ',
    fecha_firma: p.hoy,
    testigo1_nombre: '', testigo1_documento: '', testigo2_nombre: '', testigo2_documento: '',
    clausulas_adicionales: [...CLAUSULAS_ADICIONALES_POR_DEFECTO],
    observaciones: '',
  }
}

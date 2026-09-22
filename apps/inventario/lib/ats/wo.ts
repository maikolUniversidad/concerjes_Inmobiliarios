// Fila para el cargue de nómina (WO).
//
// Las columnas y su orden salen del exporte real «WO_Contratados_desde_…»:
// así nómina puede importar lo que genera el ATS sin volver a digitar nada.

export const COLUMNAS_WO = [
  'Tipo Identificación', 'Identificación', 'Identificación Ciudad', 'Primer Nombre', 'Segundo Nombre',
  'Primer Apellido', 'Segundo Apellido', 'Tipo Contrato', 'Fecha Ingreso', 'Area', 'Clase', 'Empresa', 'Cargo',
  'Salario', 'Periodo Pago', 'Centro Costos', 'Clasificación Dian', 'Cesantias', 'IntCesantias', 'Prima',
  'Vacaciones', 'Ret. Fte', 'Fecha Nacimiento', 'Ciudad', 'Tipo Dirección', 'Direccion', 'Teléfono', 'E_Mail',
  'Número hijos', 'Estado Civil', 'Declarante', 'Dotación', 'Tipo Cuenta', 'Número Cuenta', 'Banco Cuenta',
  'Tipo Sena', 'Fecha Fin Periodo Prueba', 'Fecha Fin Contrato', 'ARP', 'Fecha Afil. ARP', 'Tarifa ARP', 'EPS',
  'Fecha Afil. EPS', 'Pensión', 'Fecha Afil. AFP', 'Fondo Cesantias', 'Fecha Afil. Fondo Cesantías', 'Caja',
  'Fecha Afil. Caja', 'Código Centro Costos', 'Libreta Militar No.', 'Sexo', 'Centro De Trabajo', 'Tipo Cotizante',
  'Subtipo de Cotizante',
] as const

export interface DatosWO {
  tipo_documento: string
  numero_documento: string
  ciudad_expedicion: string
  primer_nombre: string
  segundo_nombre: string
  primer_apellido: string
  segundo_apellido: string
  tipo_contrato: string          // OBRA_LABOR | TERMINO_FIJO | INDEFINIDO
  fecha_ingreso: string          // YYYY-MM-DD
  area: string
  clase_salario: string
  empresa: string
  cargo: string
  salario: number | string
  centro_costo: string
  clasificacion_dian: string
  fecha_nacimiento: string
  ciudad_residencia: string
  tipo_direccion: string
  direccion: string
  telefono: string
  email: string
  numero_hijos: number | string
  estado_civil: string
  declarante: boolean
  dotacion: boolean
  tipo_cuenta: string
  numero_cuenta: string
  banco: string
  tipo_sena: string
  fecha_fin_periodo_prueba: string
  fecha_fin_contrato: string
  arl: string
  fecha_afil_arl: string
  tarifa_arl: number | string
  eps: string
  fecha_afil_eps: string
  afp: string
  fecha_afil_afp: string
  cesantias: string
  fecha_afil_cesantias: string
  caja: string
  fecha_afil_caja: string
  codigo_centro_costo: string
  libreta_militar: string
  genero: string
  ciudad_wo: string
  depto_wo: string
  tipo_cotizante: string
  subtipo_cotizante: string
}

/** YYYY-MM-DD → DD/MM/YYYY (como lo exporta WO). */
export function fechaWO(v: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

const TIPO_CONTRATO_WO: Record<string, string> = {
  OBRA_LABOR: 'Labor Contratada', TERMINO_FIJO: 'Término Fijo', INDEFINIDO: 'Indefinido',
}

/** Estado civil como lo escribe WO ("Soltero", "Casado", "Union Libre"…). */
export function estadoCivilWO(v: string | null | undefined): string {
  const s = String(v ?? '').toLowerCase()
  if (s.startsWith('solter')) return 'Soltero'
  if (s.startsWith('casad')) return 'Casado'
  if (s.startsWith('uni')) return 'Union Libre'
  if (s.startsWith('separ')) return 'Separado'
  if (s.startsWith('divor')) return 'Divorciado'
  if (s.startsWith('viud')) return 'Viudo'
  return v ?? ''
}

export function libretaWO(tipo: string | null | undefined): string {
  const s = String(tipo ?? '').toLowerCase()
  if (s.startsWith('1') || s.includes('primera')) return 'Primera Clase'
  if (s.startsWith('2') || s.includes('segunda')) return 'Segunda Clase'
  return 'N/A'
}

export function filaWO(d: DatosWO): (string | number)[] {
  const g = String(d.genero ?? '').toLowerCase()
  return [
    d.tipo_documento === 'CEDULA_DIGITAL' ? 'CC' : d.tipo_documento,
    d.numero_documento,
    d.ciudad_expedicion,
    d.primer_nombre, d.segundo_nombre, d.primer_apellido, d.segundo_apellido,
    TIPO_CONTRATO_WO[d.tipo_contrato] ?? d.tipo_contrato,
    fechaWO(d.fecha_ingreso),
    d.area || 'Produccion',
    d.clase_salario || 'Normal',
    d.empresa,
    d.cargo,
    Number(d.salario) || 0,
    'Mensual',
    d.centro_costo,
    d.clasificacion_dian || 'Normal',
    -1, -1, -1, -1, 0,
    fechaWO(d.fecha_nacimiento),
    d.ciudad_residencia,
    d.tipo_direccion || 'Casa',
    d.direccion,
    d.telefono,
    d.email,
    d.numero_hijos === 0 ? '' : d.numero_hijos,
    estadoCivilWO(d.estado_civil),
    d.declarante ? 'Si' : '',
    d.dotacion ? 'Si' : '',
    d.tipo_cuenta,
    d.numero_cuenta,
    d.banco,
    d.tipo_sena,
    fechaWO(d.fecha_fin_periodo_prueba),
    fechaWO(d.fecha_fin_contrato),
    d.arl,
    fechaWO(d.fecha_afil_arl),
    typeof d.tarifa_arl === 'number' ? d.tarifa_arl.toFixed(3) : d.tarifa_arl,
    d.eps,
    fechaWO(d.fecha_afil_eps),
    d.afp,
    fechaWO(d.fecha_afil_afp),
    d.cesantias,
    fechaWO(d.fecha_afil_cesantias),
    d.caja,
    fechaWO(d.fecha_afil_caja),
    d.codigo_centro_costo,
    libretaWO(d.libreta_militar),
    g.startsWith('fem') ? 'Femenino' : g.startsWith('mas') ? 'Masculino' : (d.genero ?? ''),
    d.ciudad_wo ? `Ciudad: ${d.ciudad_wo} Depto: ${d.depto_wo}` : '',
    d.tipo_cotizante || 'Dependiente',
    d.subtipo_cotizante || 'Ninguno',
  ]
}

// Tipos del módulo Registro de Vacantes (lado público).

export type TipoDoc = 'CC' | 'CE' | 'PPT' | 'PEP' | 'PASAPORTE' | 'CEDULA_DIGITAL'

export const TIPOS_DOC: { value: TipoDoc; label: string }[] = [
  { value: 'CC', label: 'Cédula de ciudadanía' },
  { value: 'CE', label: 'Cédula de extranjería' },
  { value: 'PPT', label: 'Permiso por Protección Temporal (PPT)' },
  { value: 'PEP', label: 'Permiso Especial de Permanencia (PEP)' },
  { value: 'PASAPORTE', label: 'Pasaporte' },
  { value: 'CEDULA_DIGITAL', label: 'Cédula digital' },
]

export const GENEROS = ['Masculino', 'Femenino', 'Otro', 'Prefiero no responder']
export const ESTADOS_CIVILES = [
  'Soltero(a)', 'Casado(a)', 'Unión libre', 'Separado(a)', 'Divorciado(a)', 'Viudo(a)',
]
export const RH = ['O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-']
export const ESCOLARIDAD = [
  'Primaria', 'Bachillerato incompleto', 'Bachiller', 'Técnico', 'Tecnólogo', 'Profesional', 'Posgrado',
]
export const LIBRETA = ['1ª clase', '2ª clase', 'No aplica']
export const TIPO_CUENTA = ['Ahorros', 'Corriente', 'Nequi', 'Daviplata']
export const JORNADAS = ['Diurna', 'Nocturna', 'Turnos rotativos', 'Fines de semana', 'Festivos']
export const FUENTES = ['Redes', 'Referido', 'Volante', 'Página web', 'Bolsa de empleo', 'Otro']
export const TALLA_CAMISA = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']
export const TALLA_CALZADO = ['34','35','36','37','38','39','40','41','42','43','44','45','46']
export const PARENTESCOS = ['Hijo(a)', 'Cónyuge', 'Compañero(a)', 'Padre', 'Madre', 'Hermano(a)', 'Otro']
export const VIVIENDA = ['Propia', 'Arriendo', 'Familiar']

// Estado del formulario en cliente: refleja columnas de `candidatos`.
export interface CandidatoForm {
  id?: string
  // Filtro
  ha_hecho_proceso_antes?: boolean | null
  ha_trabajado_antes?: boolean | null
  // Sección 1
  tipo_documento: TipoDoc
  numero_documento: string
  fecha_expedicion_doc?: string | null
  lugar_expedicion_doc?: string | null
  nombres?: string | null
  apellidos?: string | null
  fecha_nacimiento?: string | null
  nacionalidad?: string | null
  pais_nacimiento?: string | null
  departamento_nacimiento?: string | null
  municipio_nacimiento?: string | null
  genero?: string | null
  estado_civil?: string | null
  grupo_sanguineo?: string | null
  nivel_escolaridad?: string | null
  libreta_militar_tipo?: string | null
  libreta_militar_numero?: string | null
  distrito_militar?: string | null
  // Sección 2
  email?: string | null
  celular?: string | null
  telefono_alterno?: string | null
  contacto_emergencia_nombre?: string | null
  contacto_emergencia_parentesco?: string | null
  contacto_emergencia_telefono?: string | null
  departamento_trabajo?: string | null
  municipio_trabajo?: string | null
  // Sección 3
  eps_id?: string | null
  afp_id?: string | null
  cesantias_id?: string | null
  ccf_id?: string | null
  es_pensionado?: boolean | null
  banco_id?: string | null
  tipo_cuenta?: string | null
  numero_cuenta?: string | null
  cuenta_propia?: boolean | null
  // Sección 4
  experiencia_anios?: number | null
  experiencia_meses?: number | null
  cargo_postulacion_id?: string | null
  experiencia_cargo_anios?: number | null
  disponibilidad_jornada?: string[] | null
  fecha_disponible?: string | null
  se_puede_desplazar?: boolean | null
  aspiracion_salarial?: number | null
  fuente_reclutamiento?: string | null
  referido_por?: string | null
  // Sección 5
  talla_camisa?: string | null
  talla_pantalon?: string | null
  talla_calzado?: string | null
  talla_chaqueta?: string | null
  // Sección 6
  tiene_personas_a_cargo?: boolean | null
  conyuge_trabaja?: string | null
  // Sección 7
  vivienda_tipo?: string | null
  estrato?: number | null
  practica_deporte?: boolean | null
  horas_sueno?: string | null
  // control
  estado?: string
  paso_actual?: number
}

// Dirección de residencia (vive en candidato_direcciones, vigente).
export interface DireccionForm {
  direccion: string
  barrio?: string | null
  departamento_codigo?: string | null
  municipio_codigo?: string | null
  localidad?: string | null
}

export interface Beneficiario {
  nombres: string
  apellidos: string
  parentesco: string
  tipo_documento?: string | null
  numero_documento?: string | null
  fecha_nacimiento?: string | null
}

export interface OpcionCatalogo { id: string; nombre: string }
export interface OpcionGeo { codigo_dane: string; nombre: string; departamento_codigo?: string }

export interface TipoDocumental {
  id: string
  codigo: string
  nombre: string
  grupo: string
  obligatorio: boolean
  min_archivos: number
  max_archivos: number
  formatos_permitidos: string[]
  vigencia_dias: number | null
  requiere_ocr: boolean
  aplica_si: Record<string, unknown> | null
  ola: number
  orden: number
}

export interface Catalogos {
  departamentos: OpcionGeo[]
  municipios: OpcionGeo[]
  eps: OpcionCatalogo[]
  afp: OpcionCatalogo[]
  cesantias: OpcionCatalogo[]
  cajas: OpcionCatalogo[]
  bancos: OpcionCatalogo[]
  cargos: OpcionCatalogo[]
}

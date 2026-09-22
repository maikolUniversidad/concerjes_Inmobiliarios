/* eslint-disable @typescript-eslint/no-explicit-any */

/** Fila de `vw_ats_bandeja`. */
export interface FilaBandeja {
  id: string
  estado: string
  fase_desde: string
  dias_en_fase: number
  tipo_documento: string
  numero_documento: string
  nombres: string | null
  apellidos: string | null
  email: string | null
  celular: string | null
  cargo_postulacion_id: string | null
  cargo: string | null
  ciudad_trabajo: string | null
  centro_costo_id: string | null
  centro_costo: string | null
  requisicion_id: string | null
  requisicion: string | null
  motivo_descarte: string | null
  ips_nombre: string | null
  ips_fecha_remision: string | null
  antecedentes_resultado: string | null
  ha_trabajado_antes: boolean | null
  persona_id: string | null
  foto_perfil_path: string | null
  auth_uid: string | null
  created_at: string
  updated_at: string
  docs_total: number
  docs_validados: number
  docs_rechazados: number
  pruebas_presentadas: number
  puntaje_conocimientos: string | null
  docs_por_firmar: number
  docs_firmados: number
  contrato_codigo: string | null
  referencias_total: number
  referencias_verificadas: number
}

export interface Opcion { id: string; nombre: string }
export interface CargoOpcion extends Opcion {
  requiere_manipulacion_alimentos: boolean
  requiere_trabajo_alturas: boolean
  requiere_libreta_militar: boolean
  requiere_curso_grecas: boolean
}
export interface CentroOpcion { id: string; codigo: string; nombre: string; ciudad: string | null }
export interface RequisicionOpcion { id: string; numero: string; cliente_nombre: string | null; cargo_texto: string | null; cantidad: number; cupos_cubiertos: number; estado: string }
export interface IpsOpcion {
  id: string; nombre: string; correo: string | null; correos_copia: string[] | null
  telefono: string | null; direccion: string | null; ciudad: string | null; notas: string | null
}
export interface MotivoOpcion { valor: string; etiqueta: string }
export interface TipoDocOpcion {
  id: string; codigo: string; nombre: string; grupo: string; obligatorio: boolean
  min_archivos: number; max_archivos: number; ola: number; aplica_si: any; vigencia_dias: number | null
  descripcion: string | null; sube_staff: boolean; activo: boolean; formatos_permitidos: string[] | null
}
export interface RolOpcion { id: string; nombre: string; rol_base: string | null }
export interface PlantillaOpcion {
  id: string; codigo: string; nombre: string; momento: string; orden: number; obligatoria: boolean
  requiere_contrato: boolean; requiere_firma_trabajador: boolean; visible_candidato: boolean
  permite_firma_electronica: boolean; version_vigente: number; descripcion: string | null
}

export interface Catalogos {
  cargos: CargoOpcion[]
  centros: CentroOpcion[]
  requisiciones: RequisicionOpcion[]
  ips: IpsOpcion[]
  motivos: MotivoOpcion[]
  tipos: TipoDocOpcion[]
  roles: RolOpcion[]
  arl: Opcion[]
  plantillas: PlantillaOpcion[]
  smlv: number | null
}

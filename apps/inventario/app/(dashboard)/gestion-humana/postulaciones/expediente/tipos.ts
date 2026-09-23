/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Catalogos } from '../tipos'

/** Todo lo que el expediente carga de un candidato. Filas de BD en `any` (convención del repo). */
export interface DatosExp {
  c: any
  dir: any | null
  bens: any[]
  estudios: any[]
  experiencias: any[]
  referencias: any[]
  docs: any[]
  consentimientos: any[]
  eventos: any[]
  observaciones: any[]
  evaluaciones: any[]
  intentos: any[]
  /** Pruebas que aplican al candidato con su intento (vac_pruebas_de_candidato). */
  pruebas: any[]
  contratos: any[]
  generados: any[]
  historial: any[]
  nombres: {
    munNacimiento: string; depNacimiento: string; munTrabajo: string; depTrabajo: string
    munResidencia: string; depResidencia: string
    eps: any | null; afp: any | null; cesantias: any | null; caja: any | null; banco: any | null
  }
  nomina: any | null
  cajaNomina: any | null
  rolId: string
  fotoUrl: string | null
  yo: { id: string | null; nombre: string | null }
}

export interface PropsTab {
  d: DatosExp
  sb: any
  catalogos: Catalogos
  puedeGestionar: boolean
  recargar: () => Promise<void>
  onCambio: () => void
}

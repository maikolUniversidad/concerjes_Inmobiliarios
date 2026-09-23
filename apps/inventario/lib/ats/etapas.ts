// Etapas del expediente: las mismas bandejas de Postulaciones, con el mismo
// nombre y orden. El expediente abre en la etapa en que va el candidato y cada
// etapa dice qué falta para pasar a la siguiente.

import { faseMeta, esCorte, type BandejaKey } from './fases'

export type EtapaKey = 'postulacion' | 'evaluacion' | 'seguridad' | 'examenes' | 'contratacion' | 'historial'

export interface Etapa {
  key: EtapaKey
  /** Número del paso (null en Historial, que no es un paso). */
  n: number | null
  label: string
  subtitulo: string
  bandejas: BandejaKey[]
}

export const ETAPAS: Etapa[] = [
  { key: 'postulacion', n: 1, label: 'Postulación', subtitulo: 'Registro y validación · pruebas', bandejas: ['POSTULACION'] },
  { key: 'evaluacion', n: 2, label: 'Psicológica', subtitulo: 'Entrevista y referencias', bandejas: ['EVALUACION'] },
  { key: 'seguridad', n: 3, label: 'Seguridad AAA', subtitulo: 'Estudio de seguridad y antecedentes', bandejas: ['SEGURIDAD'] },
  { key: 'examenes', n: 4, label: 'Exámenes', subtitulo: 'Remisión a la IPS y concepto de aptitud', bandejas: ['EXAMENES'] },
  { key: 'contratacion', n: 5, label: 'Contratación', subtitulo: 'Foto, contrato, firmas, paquete y nómina', bandejas: ['CONTRATACION', 'CONTRATADOS'] },
  { key: 'historial', n: null, label: 'Historial', subtitulo: 'Bitácora, observaciones y autorizaciones', bandejas: ['DESCARTADOS'] },
]

/** Etapa (pestaña) en la que debe abrir el expediente según la fase del candidato. */
export function etapaDeEstado(estado: string | null | undefined): EtapaKey {
  if (!estado) return 'postulacion'
  const bandeja = faseMeta(estado).bandeja
  return ETAPAS.find((e) => e.bandejas.includes(bandeja))?.key ?? 'postulacion'
}

export type EstadoEtapa = 'hecha' | 'actual' | 'pendiente' | 'cerrada'

/** Cómo va una etapa para este candidato (hecha, en curso, por venir o proceso cerrado). */
export function estadoEtapa(etapa: EtapaKey, estadoCandidato: string): EstadoEtapa {
  if (etapa === 'historial') return 'pendiente'
  if (esCorte(estadoCandidato)) return 'cerrada'
  const orden = (k: EtapaKey) => ETAPAS.findIndex((e) => e.key === k)
  const actual = orden(etapaDeEstado(estadoCandidato))
  const esta = orden(etapa)
  if (esta < actual) return 'hecha'
  if (esta === actual) return ['CONTRATADO', 'ACTIVO'].includes(estadoCandidato) ? 'hecha' : 'actual'
  return 'pendiente'
}

/** Lo que el expediente sabe del candidato para armar la lista de pendientes. */
export interface ResumenExpediente {
  docsFaltantesRegistro: string[]
  docsPorRevisar: number
  pruebasPresentadas: number
  pruebasTotal: number
  centroCosto: boolean
  entrevista: 'NINGUNA' | 'PENDIENTE' | 'APROBADO' | 'NO_APROBADO'
  referenciasVerificadas: number
  referenciasTotal: number
  seguridadRegistrada: boolean
  antecedentes: string
  remitidoIps: boolean
  conceptoCargado: boolean
  apto: boolean
  foto: boolean
  docsFaltantesVinculacion: string[]
  contrato: boolean
  generados: number
  porFirmar: number
  contratado: boolean
}

export interface Requisito { texto: string; ok: boolean; detalle?: string }

const lista = (xs: string[], max = 3) => xs.slice(0, max).join(', ') + (xs.length > max ? ` y ${xs.length - max} más` : '')

/** Qué hace falta en cada etapa (se muestra como lista de chequeo arriba de la pestaña). */
export function requisitosEtapa(etapa: EtapaKey, r: ResumenExpediente): Requisito[] {
  switch (etapa) {
    case 'postulacion':
      return [
        { texto: 'Documentos obligatorios del registro', ok: r.docsFaltantesRegistro.length === 0, detalle: r.docsFaltantesRegistro.length ? `Faltan: ${lista(r.docsFaltantesRegistro)}` : undefined },
        { texto: 'Documentos revisados', ok: r.docsPorRevisar === 0, detalle: r.docsPorRevisar ? `${r.docsPorRevisar} por validar o rechazar` : undefined },
        { texto: 'Pruebas de selección', ok: r.pruebasTotal > 0 && r.pruebasPresentadas >= r.pruebasTotal, detalle: `${r.pruebasPresentadas} de ${r.pruebasTotal} presentadas` },
        { texto: 'Centro de costos asignado', ok: r.centroCosto },
      ]
    case 'evaluacion': {
      const minimas = Math.min(2, r.referenciasTotal)
      return [
        { texto: 'Entrevista registrada', ok: r.entrevista !== 'NINGUNA' },
        { texto: 'Entrevista aprobada', ok: r.entrevista === 'APROBADO', detalle: r.entrevista === 'NO_APROBADO' ? 'No aprobada' : r.entrevista === 'PENDIENTE' ? 'Resultado pendiente' : undefined },
        { texto: 'Referencias verificadas', ok: r.referenciasTotal > 0 && r.referenciasVerificadas >= minimas, detalle: `${r.referenciasVerificadas} de ${r.referenciasTotal}` },
      ]
    }
    case 'seguridad':
      return [
        { texto: 'Estudio de seguridad AAA', ok: r.seguridadRegistrada },
        { texto: 'Antecedentes sin novedad', ok: r.antecedentes === 'SIN_NOVEDAD', detalle: r.antecedentes === 'CON_NOVEDAD' ? 'Con novedad' : r.antecedentes === 'SIN_NOVEDAD' ? undefined : 'Sin verificar' },
      ]
    case 'examenes':
      return [
        { texto: 'Remitido a la IPS', ok: r.remitidoIps },
        { texto: 'Concepto de aptitud cargado', ok: r.conceptoCargado },
        { texto: 'Marcado apto', ok: r.apto },
      ]
    case 'contratacion':
      return [
        { texto: 'Foto de perfil', ok: r.foto },
        { texto: 'Documentos de vinculación', ok: r.docsFaltantesVinculacion.length === 0, detalle: r.docsFaltantesVinculacion.length ? `Faltan: ${lista(r.docsFaltantesVinculacion)}` : undefined },
        { texto: 'Contrato guardado', ok: r.contrato },
        { texto: 'Formatos generados y firmados', ok: r.generados > 0 && r.porFirmar === 0, detalle: r.generados === 0 ? 'Sin generar' : r.porFirmar ? `${r.porFirmar} por firmar` : undefined },
        { texto: 'Entregado a nómina', ok: r.contratado },
      ]
    default:
      return []
  }
}

import { ordenFase, tipoAplicaCargo } from '@/lib/ats/fases'
import type { ResumenExpediente } from '@/lib/ats/etapas'
import type { Catalogos } from '../tipos'
import type { DatosExp } from './tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Lo que dice el expediente de cada etapa, para la lista «qué falta» de las pestañas. */
export function resumenExpediente(d: DatosExp, catalogos: Catalogos): ResumenExpediente {
  const flags = catalogos.cargos.find((x) => x.id === d.c.cargo_postulacion_id) as unknown as Record<string, unknown> | undefined
  const tipos = catalogos.tipos.filter((t) => t.activo !== false && tipoAplicaCargo(t, flags))
  const vigentes = (tipoId: string) => d.docs.filter((x) => x.tipo_documental_id === tipoId && x.estado !== 'RECHAZADO').length
  const faltantes = (ola: number) =>
    tipos.filter((t) => t.ola === ola && t.obligatorio && vigentes(t.id) < Math.max(1, t.min_archivos)).map((t) => t.nombre)
  const delRegistro = new Set(tipos.filter((t) => t.ola === 1).map((t) => t.id))
  const entrevista = d.evaluaciones.find((e) => e.tipo === 'ENTREVISTA')
  const concepto = catalogos.tipos.find((t) => t.codigo === 'CONCEPTO_APTITUD')
  const generados = d.generados.filter((g) => g.estado !== 'ANULADO')
  const obligatorias = d.pruebas.filter((p: any) => p.obligatoria)

  return {
    docsFaltantesRegistro: faltantes(1),
    docsPorRevisar: d.docs.filter((x) => delRegistro.has(x.tipo_documental_id) && x.estado === 'CARGADO').length,
    pruebasTotal: obligatorias.length,
    pruebasPresentadas: obligatorias.filter((p: any) => p.intento_estado && p.intento_estado !== 'EN_CURSO').length,
    centroCosto: !!d.c.centro_costo_id,
    entrevista: !entrevista ? 'NINGUNA' : entrevista.resultado === 'APROBADO' ? 'APROBADO' : entrevista.resultado === 'NO_APROBADO' ? 'NO_APROBADO' : 'PENDIENTE',
    referenciasVerificadas: d.referencias.filter((r) => r.verificada).length,
    referenciasTotal: d.referencias.length,
    seguridadRegistrada: d.evaluaciones.some((e) => e.tipo === 'SEGURIDAD'),
    antecedentes: d.c.antecedentes_resultado ?? 'PENDIENTE',
    remitidoIps: !!d.c.ips_fecha_remision,
    conceptoCargado: !!concepto && d.docs.some((x) => x.tipo_documental_id === concepto.id && x.estado !== 'RECHAZADO'),
    apto: ordenFase(d.c.estado) >= ordenFase('APTO'),
    foto: !!d.c.foto_perfil_path,
    docsFaltantesVinculacion: faltantes(2),
    contrato: d.contratos.some((k) => k.estado !== 'ANULADO'),
    generados: generados.length,
    porFirmar: generados.filter((g) => g.estado === 'PENDIENTE_FIRMA').length,
    contratado: ['CONTRATADO', 'ACTIVO'].includes(d.c.estado),
  }
}

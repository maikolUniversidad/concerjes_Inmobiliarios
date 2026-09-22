import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { COLUMNAS_WO, filaWO, type DatosWO } from '@/lib/ats/wo'

export const runtime = 'nodejs'
export const maxDuration = 60

/* eslint-disable @typescript-eslint/no-explicit-any */

// Excel para el cargue en nómina (WO) de uno o varios candidatos contratados.
// Mismas columnas y formato del exporte «WO_Contratados_desde_…».
export async function POST(req: NextRequest) {
  const permisos = await getPermisosUsuario()
  if (!permisos.puede('ver_postulaciones') && !permisos.puede('gestionar_postulaciones')) {
    return NextResponse.json({ error: 'No autorizado.' }, { status: 403 })
  }
  const { ids } = (await req.json().catch(() => ({}))) as { ids?: string[] }
  if (!Array.isArray(ids) || !ids.length) return NextResponse.json({ error: 'Seleccione al menos un candidato.' }, { status: 400 })

  const sb = (await createClient()) as any
  const { data: cands, error } = await sb.from('candidatos').select('*').in('id', ids.slice(0, 500))
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const [{ data: contratos }, { data: dirs }, { data: bens }, { data: empresa }] = await Promise.all([
    sb.from('contratos').select('*').in('candidato_id', ids).neq('estado', 'ANULADO').order('generado_at', { ascending: false }),
    sb.from('candidato_direcciones').select('candidato_id, direccion, municipio_codigo').in('candidato_id', ids).is('vigente_hasta', null),
    sb.from('beneficiarios').select('candidato_id, parentesco').in('candidato_id', ids),
    sb.from('vac_empresa').select('razon_social').eq('id', 1).maybeSingle(),
  ])
  const contratoDe = (id: string) => (contratos ?? []).find((k: any) => k.candidato_id === id) ?? null

  const idsDe = (campo: string, extra?: (k: any) => unknown) =>
    [...new Set([...(cands ?? []).map((c: any) => c[campo]), ...(contratos ?? []).map((k: any) => extra?.(k))].filter(Boolean))] as string[]
  const cat = async (tabla: string, lista: string[], campos = 'id, nombre, codigo_nomina') =>
    lista.length ? ((await sb.from(tabla).select(campos).in('id', lista)).data ?? []) : []
  const municipiosIds = [...new Set([
    ...(cands ?? []).map((c: any) => c.municipio_trabajo), ...(dirs ?? []).map((d: any) => d.municipio_codigo),
  ].filter(Boolean))] as string[]

  const [muns, munNom] = await Promise.all([
    municipiosIds.length ? ((await sb.from('municipios').select('codigo_dane, nombre').in('codigo_dane', municipiosIds)).data ?? []) : [],
    municipiosIds.length ? ((await sb.from('municipios_nomina').select('*').in('municipio_codigo', municipiosIds)).data ?? []) : [],
  ])
  // La caja por defecto sale de la ciudad de trabajo (como el "resumen de códigos para nómina").
  const cajasIds = [...new Set([...idsDe('ccf_id', (k) => k.ccf_id), ...(munNom as any[]).map((m) => m.ccf_id)].filter(Boolean))] as string[]
  const [eps, afp, ces, cajas, bancos, arl, cargos, centros] = await Promise.all([
    cat('eps', idsDe('eps_id', (k) => k.eps_id)),
    cat('afp', idsDe('afp_id', (k) => k.afp_id)),
    cat('cesantias', idsDe('cesantias_id', (k) => k.cesantias_id)),
    cat('cajas_compensacion', cajasIds),
    cat('bancos', idsDe('banco_id')),
    cat('arl', [...new Set((contratos ?? []).map((k: any) => k.arl_id).filter(Boolean))] as string[]),
    cat('cargos', idsDe('cargo_postulacion_id', (k) => k.cargo_id), 'id, nombre'),
    cat('centros_costo', idsDe('centro_costo_id', (k) => k.centro_costo_id), 'id, codigo, nombre'),
  ])
  const nom = (lista: any[], id: unknown) => {
    const x = lista.find((r) => r.id === id)
    return x ? (x.codigo_nomina || x.nombre) : ''
  }

  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('WO')
  ws.addRow([...COLUMNAS_WO])
  ws.getRow(1).font = { bold: true }

  for (const c of cands ?? []) {
    const k = contratoDe(c.id)
    const dir = (dirs ?? []).find((d: any) => d.candidato_id === c.id)
    const mnom = (munNom as any[]).find((m) => m.municipio_codigo === c.municipio_trabajo)
    const centro = (centros as any[]).find((x) => x.id === (k?.centro_costo_id ?? c.centro_costo_id))
    const datos: DatosWO = {
      tipo_documento: c.tipo_documento, numero_documento: c.numero_documento,
      ciudad_expedicion: c.lugar_expedicion_doc ?? '',
      primer_nombre: c.primer_nombre ?? '', segundo_nombre: c.segundo_nombre ?? '',
      primer_apellido: c.primer_apellido ?? '', segundo_apellido: c.segundo_apellido ?? '',
      tipo_contrato: k?.tipo_contrato ?? 'OBRA_LABOR', fecha_ingreso: k?.fecha_inicio_labores ?? '',
      area: k?.area ?? 'Produccion', clase_salario: k?.clase_salario ?? 'Normal',
      empresa: empresa?.razon_social ?? 'CONSERJES INMOBILIARIOS LTDA',
      cargo: (cargos as any[]).find((x) => x.id === (k?.cargo_id ?? c.cargo_postulacion_id))?.nombre ?? '',
      salario: k?.salario ?? '', centro_costo: centro?.nombre ?? '', clasificacion_dian: k?.clasificacion_dian ?? 'Normal',
      fecha_nacimiento: c.fecha_nacimiento ?? '',
      ciudad_residencia: (muns as any[]).find((m) => m.codigo_dane === dir?.municipio_codigo)?.nombre ?? '',
      tipo_direccion: k?.tipo_direccion ?? 'Casa', direccion: dir?.direccion ?? '', telefono: c.celular ?? '', email: c.email ?? '',
      numero_hijos: (bens ?? []).filter((b: any) => b.candidato_id === c.id && /^hij/i.test(b.parentesco ?? '')).length,
      estado_civil: c.estado_civil ?? '', declarante: !!k?.declarante, dotacion: k?.dotacion ?? true,
      tipo_cuenta: c.tipo_cuenta ?? '', numero_cuenta: c.numero_cuenta ?? '', banco: nom(bancos as any[], c.banco_id),
      tipo_sena: k?.tipo_sena ?? '', fecha_fin_periodo_prueba: k?.fecha_fin_periodo_prueba ?? '', fecha_fin_contrato: k?.fecha_fin_contrato ?? '',
      arl: nom(arl as any[], k?.arl_id), fecha_afil_arl: k?.fecha_afil_arl ?? '', tarifa_arl: Number(k?.tarifa_arl ?? 1.044),
      eps: nom(eps as any[], k?.eps_id ?? c.eps_id), fecha_afil_eps: k?.fecha_afil_eps ?? '',
      afp: nom(afp as any[], k?.afp_id ?? c.afp_id), fecha_afil_afp: k?.fecha_afil_afp ?? '',
      cesantias: nom(ces as any[], k?.cesantias_id ?? c.cesantias_id), fecha_afil_cesantias: k?.fecha_afil_cesantias ?? '',
      caja: nom(cajas as any[], k?.ccf_id ?? c.ccf_id ?? mnom?.ccf_id), fecha_afil_caja: k?.fecha_afil_ccf ?? '',
      codigo_centro_costo: '', libreta_militar: c.libreta_militar_tipo ?? '', genero: c.genero ?? '',
      ciudad_wo: mnom?.ciudad_wo ?? '', depto_wo: mnom?.depto_wo ?? '',
      tipo_cotizante: k?.tipo_cotizante ?? 'Dependiente', subtipo_cotizante: k?.subtipo_cotizante ?? 'Ninguno',
    }
    ws.addRow(filaWO(datos))
  }
  ws.columns.forEach((col) => { col.width = 18 })

  const buffer = await wb.xlsx.writeBuffer()
  const hoy = new Date().toISOString().slice(0, 10)
  return new NextResponse(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="WO_Contratados_${hoy}.xlsx"`,
    },
  })
}

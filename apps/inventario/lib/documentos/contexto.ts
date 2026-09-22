// Arma el contexto con el que se llenan las plantillas de documentos.
//
// Sale TODO de lo que el candidato llenó en el formulario (más lo que RRHH
// registró: contrato, entrevista, centro de costos). Así la persona solo firma
// y nadie vuelve a escribir sus datos a mano. El contrato de las variables está
// en `variables.ts`: si se agrega una aquí, va también allá.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { agregarFormato } from './variables'
import { edadDesde, fechaCorta, fechaLarga, numeroEnLetras, parsearFecha } from './plantilla'

type DB = any

export const TIPO_DOC_NOMBRE: Record<string, string> = {
  CC: 'Cédula de ciudadanía', CE: 'Cédula de extranjería', PPT: 'Permiso por Protección Temporal',
  PEP: 'Permiso Especial de Permanencia', PASAPORTE: 'Pasaporte', CEDULA_DIGITAL: 'Cédula digital',
}

export const MODALIDAD_NOMBRE: Record<string, string> = {
  OBRA_LABOR: 'Por la duración de una obra o labor determinada',
  TERMINO_FIJO: 'A término fijo',
  INDEFINIDO: 'A término indefinido',
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const p2 = (n: number) => String(n).padStart(2, '0')

/** Fecha civil de hoy en Bogotá (el servidor corre en UTC). */
export function hoyBogota(ahora = new Date()): Date {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahora)
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "1 año y 8 meses" entre dos fechas (o hasta hoy). */
export function tiempoEntre(desde: unknown, hasta: unknown, hoy = new Date()): string {
  const a = parsearFecha(desde)
  if (!a) return ''
  const b = parsearFecha(hasta) ?? hoy
  let meses = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth())
  if (b.getDate() < a.getDate()) meses--
  if (meses < 0) return ''
  const anios = Math.floor(meses / 12)
  const resto = meses % 12
  const partes: string[] = []
  if (anios) partes.push(`${anios} ${anios === 1 ? 'año' : 'años'}`)
  if (resto) partes.push(`${resto} ${resto === 1 ? 'mes' : 'meses'}`)
  return partes.length ? partes.join(' y ') : 'Menos de un mes'
}

/** "los primeros dos (2) meses calendario de labores" a partir de los días del periodo de prueba. */
export function textoPeriodoPrueba(dias: number | null | undefined): string {
  const d = Number(dias ?? 0)
  if (!d) return 'sin periodo de prueba'
  if (d % 30 === 0) {
    const m = d / 30
    return m === 1 ? 'el primer (1) mes calendario de labores' : `los primeros ${numeroEnLetras(m)} (${m}) meses calendario de labores`
  }
  return `los primeros ${numeroEnLetras(d)} (${d}) días calendario de labores`
}

function experienciaTexto(anios?: number | null, meses?: number | null): string {
  const a = Number(anios ?? 0), m = Number(meses ?? 0)
  const partes: string[] = []
  if (a) partes.push(`${a} ${a === 1 ? 'año' : 'años'}`)
  if (m) partes.push(`${m} ${m === 1 ? 'mes' : 'meses'}`)
  return partes.length ? partes.join(' y ') : 'Sin experiencia'
}

/** "CHINCHINÁ (CALDAS)"; sin repetir cuando la ciudad y el departamento se llaman igual (Bogotá). */
export function lugarConDepto(ciudad?: string | null, depto?: string | null): string {
  if (!ciudad) return depto ?? ''
  if (!depto) return ciudad
  const n = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Z]/gi, '').toUpperCase()
  return n(ciudad) === n(depto) || n(depto).startsWith(n(ciudad)) ? ciudad : `${ciudad} (${depto})`
}

function tipoAplica(aplicaSi: Record<string, unknown> | null, flags: Record<string, unknown>): boolean {
  if (!aplicaSi) return true
  return Object.entries(aplicaSi).every(([k, esperado]) => Boolean(flags[k.replace(/^cargo\./, '')]) === esperado)
}

export interface OpcionesContexto {
  contratoId?: string | null
  extras?: Record<string, string>
  ahora?: Date
}

/** Construye el contexto completo de un candidato. Lanza si el candidato no existe o no es visible. */
export async function construirContexto(sb: DB, candidatoId: string, op: OpcionesContexto = {}): Promise<Record<string, unknown>> {
  const { data: c, error } = await sb.from('candidatos').select('*').eq('id', candidatoId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!c) throw new Error('Candidato no encontrado.')

  const contratoQ = op.contratoId
    ? sb.from('contratos').select('*').eq('id', op.contratoId).maybeSingle()
    : sb.from('contratos').select('*').eq('candidato_id', candidatoId).neq('estado', 'ANULADO')
        .order('generado_at', { ascending: false }).limit(1).maybeSingle()

  const [dirR, bensR, estR, expR, refR, contratoR, empresaR, politR, entrevR, tiposR, docsR, paramR, histR, reqR] = await Promise.all([
    sb.from('candidato_direcciones').select('*').eq('candidato_id', candidatoId).is('vigente_hasta', null)
      .order('vigente_desde', { ascending: false }).limit(1).maybeSingle(),
    sb.from('beneficiarios').select('*').eq('candidato_id', candidatoId),
    sb.from('candidato_estudios').select('*').eq('candidato_id', candidatoId).order('orden'),
    sb.from('candidato_experiencias').select('*').eq('candidato_id', candidatoId).order('orden'),
    sb.from('candidato_referencias').select('*').eq('candidato_id', candidatoId).order('orden'),
    contratoQ,
    sb.from('vac_empresa').select('*').eq('id', 1).maybeSingle(),
    sb.from('vac_listas_opciones').select('etiqueta').eq('lista', 'POLITICA_ORGANIZACIONAL').eq('activo', true).order('orden'),
    sb.from('candidato_evaluaciones').select('*').eq('candidato_id', candidatoId).eq('tipo', 'ENTREVISTA')
      .order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('vac_tipos_documentales').select('id, codigo, nombre, obligatorio, min_archivos, aplica_si, ola, orden, descripcion, activo').order('orden'),
    sb.from('candidato_documentos').select('tipo_documental_id, estado').eq('candidato_id', candidatoId),
    sb.from('parametros_legales').select('*').order('anio', { ascending: false }),
    c.numero_documento ? sb.rpc('historial_laboral', { p_documento: c.numero_documento }) : Promise.resolve({ data: [] }),
    c.requisicion_id ? sb.from('requisiciones').select('*').eq('id', c.requisicion_id).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const dir = dirR.data ?? null
  const k = contratoR.data ?? null
  const empresa = empresaR.data ?? {}

  // ── Catálogos por id ────────────────────────────────────────────────────────
  const codMun = [c.municipio_nacimiento, c.municipio_trabajo, dir?.municipio_codigo].filter(Boolean)
  const codDep = [c.departamento_nacimiento, c.departamento_trabajo, dir?.departamento_codigo].filter(Boolean)
  const cargoId = k?.cargo_id ?? c.cargo_postulacion_id
  const centroId = k?.centro_costo_id ?? c.centro_costo_id
  const porIds = (tabla: string, ids: unknown[], campos = 'id, nombre, codigo_nomina') => {
    const limpios = [...new Set(ids.filter(Boolean))] as string[]
    return limpios.length ? sb.from(tabla).select(campos).in('id', limpios) : Promise.resolve({ data: [] })
  }
  const [munR, depR, epsR, afpR, cesR, cajaR, bancoR, arlR, cargoR, centroR] = await Promise.all([
    codMun.length ? sb.from('municipios').select('codigo_dane, nombre').in('codigo_dane', codMun) : Promise.resolve({ data: [] }),
    codDep.length ? sb.from('departamentos').select('codigo_dane, nombre').in('codigo_dane', codDep) : Promise.resolve({ data: [] }),
    porIds('eps', [c.eps_id, k?.eps_id]),
    porIds('afp', [c.afp_id, k?.afp_id]),
    porIds('cesantias', [c.cesantias_id, k?.cesantias_id]),
    porIds('cajas_compensacion', [c.ccf_id, k?.ccf_id]),
    porIds('bancos', [c.banco_id]),
    porIds('arl', [k?.arl_id]),
    cargoId ? sb.from('cargos').select('*').eq('id', cargoId).maybeSingle() : Promise.resolve({ data: null }),
    centroId ? sb.from('centros_costo').select('id, codigo, nombre, ciudad').eq('id', centroId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const mun = new Map<string, string>((munR.data ?? []).map((m: any) => [m.codigo_dane, m.nombre]))
  const dep = new Map<string, string>((depR.data ?? []).map((d: any) => [d.codigo_dane, d.nombre]))
  const nombreDe = (r: { data: any[] | null }, id: unknown) => (r.data ?? []).find((x: any) => x.id === id)?.nombre ?? ''
  const cargo = cargoR.data ?? null
  const centro = centroR.data ?? null

  const hoy = hoyBogota(op.ahora)
  const esFemenino = /femenin/i.test(String(c.genero ?? ''))

  // ── Hoja de vida estructurada ──────────────────────────────────────────────
  const estudios = (estR.data ?? []).map((e: any) => ({
    nivel: e.nivel, institucion: e.institucion ?? '', titulo: e.titulo ?? '', ciudad: e.ciudad ?? '',
    anio_finalizacion: e.anio_finalizacion ?? '', ultimo_curso_aprobado: e.ultimo_curso_aprobado ?? '',
    en_curso: !!e.en_curso, intensidad_horaria: e.intensidad_horaria ?? '', vigencia: e.vigencia ?? '',
  }))
  const primeroDe = (...niveles: string[]) => estudios.find((e: any) => niveles.includes(e.nivel)) ?? {}
  const experiencias = (expR.data ?? []).map((x: any) => ({
    empresa: x.empresa, cargo: x.cargo ?? '', direccion: x.direccion ?? '', telefono: x.telefono ?? '',
    jefe_inmediato: x.jefe_inmediato ?? '', cargo_jefe: x.cargo_jefe ?? '',
    fecha_ingreso: x.fecha_ingreso ?? '', fecha_retiro: x.trabaja_actualmente ? '' : (x.fecha_retiro ?? ''),
    trabaja_actualmente: !!x.trabaja_actualmente, motivo_retiro: x.motivo_retiro ?? '', funciones: x.funciones ?? '',
    tipo_contrato: x.tipo_contrato ?? '', salario_inicial: x.salario_inicial ?? '', salario_final: x.salario_final ?? '',
    tiempo_laborado: tiempoEntre(x.fecha_ingreso, x.trabaja_actualmente ? null : x.fecha_retiro, hoy),
  }))
  const refs = (refR.data ?? []).map((r: any) => ({
    tipo: r.tipo, nombre: r.nombre, parentesco: r.parentesco ?? '', ocupacion: r.ocupacion ?? '', telefono: r.telefono ?? '',
    direccion: r.direccion ?? '', empresa: r.empresa ?? '', telefono_empresa: r.telefono_empresa ?? '',
  }))
  const beneficiarios = (bensR.data ?? []).map((b: any) => ({
    nombre_completo: `${b.nombres ?? ''} ${b.apellidos ?? ''}`.trim(), nombres: b.nombres, apellidos: b.apellidos,
    parentesco: b.parentesco ?? '', tipo_documento: b.tipo_documento ?? '', numero_documento: b.numero_documento ?? '',
    fecha_nacimiento: b.fecha_nacimiento ?? '', edad: edadDesde(b.fecha_nacimiento, hoy) ?? '',
  }))

  // ── Documentos del expediente ───────────────────────────────────────────────
  const flags: Record<string, unknown> = cargo ?? {}
  const cargados = new Map<string, number>()
  for (const d of docsR.data ?? []) {
    if (d.estado === 'RECHAZADO') continue
    cargados.set(d.tipo_documental_id, (cargados.get(d.tipo_documental_id) ?? 0) + 1)
  }
  const tiposAplicables = (tiposR.data ?? []).filter((t: any) => t.activo !== false && t.ola <= 2 && tipoAplica(t.aplica_si, flags))
  const listaDocs = tiposAplicables.map((t: any) => ({
    nombre: t.nombre, obligatorio: !!t.obligatorio, descripcion: t.descripcion ?? '',
    cargado: (cargados.get(t.id) ?? 0) >= Math.max(1, t.min_archivos ?? 1),
  }))

  // ── Parámetros legales del año ─────────────────────────────────────────────
  const params = (paramR.data ?? []).find((p: any) => p.anio <= hoy.getFullYear()) ?? (paramR.data ?? [])[0] ?? {}

  // ── Contrato ────────────────────────────────────────────────────────────────
  const contrato = k ? {
    existe: true,
    codigo: k.codigo, tipo_contrato: k.tipo_contrato, tipo_contrato_nombre: MODALIDAD_NOMBRE[k.tipo_contrato] ?? k.tipo_contrato,
    fecha_inicio_labores: k.fecha_inicio_labores, salario: Number(k.salario) || '', salario_texto: k.salario_texto ?? '',
    periodo_pago: k.periodo_pago, lugar_labores: k.lugar_labores, ciudad_contratacion: k.ciudad_contratacion,
    contrato_servicio: k.contrato_servicio ?? '', centro_costo: centro?.codigo ?? '', centro_costo_nombre: centro?.nombre ?? '',
    periodo_prueba_dias: k.periodo_prueba_dias, periodo_prueba_texto: textoPeriodoPrueba(k.periodo_prueba_dias),
    fecha_fin_periodo_prueba: k.fecha_fin_periodo_prueba ?? '', fecha_fin_contrato: k.fecha_fin_contrato ?? '',
    modalidad_jornada: k.modalidad_jornada, ciudad_firma: k.ciudad_firma ?? k.ciudad_contratacion ?? '',
    fecha_firma: k.fecha_firma ?? k.fecha_inicio_labores ?? '',
    testigo1_nombre: k.testigo1_nombre ?? '', testigo1_documento: k.testigo1_documento ?? '',
    testigo2_nombre: k.testigo2_nombre ?? '', testigo2_documento: k.testigo2_documento ?? '',
    clausulas_adicionales: k.clausulas_adicionales ?? [],
    arl: nombreDe(arlR, k.arl_id), eps: nombreDe(epsR, k.eps_id ?? c.eps_id), afp: nombreDe(afpR, k.afp_id ?? c.afp_id),
    cesantias: nombreDe(cesR, k.cesantias_id ?? c.cesantias_id), caja: nombreDe(cajaR, k.ccf_id ?? c.ccf_id),
    observaciones: k.observaciones ?? '',
  } : { existe: false, centro_costo: centro?.codigo ?? '', centro_costo_nombre: centro?.nombre ?? '', clausulas_adicionales: [] }

  // ── Entrevista (evaluación registrada por RRHH) ────────────────────────────
  const ev = entrevR.data ?? null
  const datosEv = (ev?.datos ?? {}) as Record<string, unknown>
  const entrevista = ev ? {
    existe: true, fecha: ev.fecha, evaluador_nombre: ev.evaluador_nombre ?? op.extras?.evaluador_nombre ?? '',
    concepto_general: ev.concepto ?? '', resultado: ev.resultado ?? '', ...datosEv,
  } : { existe: false, convivientes: [], trayectoria: [] }

  const req = reqR.data ?? null
  const nombresCompletos = [c.nombres, c.apellidos].filter(Boolean).join(' ')
  const direccion = dir?.direccion ?? ''
  const ciudadRes = dir?.municipio_codigo ? (mun.get(dir.municipio_codigo) ?? '') : ''

  const contexto: Record<string, unknown> = {
    empresa: {
      razon_social: empresa.razon_social ?? 'CONSERJES INMOBILIARIOS LTDA', nit: empresa.nit ?? '',
      direccion: empresa.direccion ?? '', ciudad: empresa.ciudad ?? 'BOGOTÁ D.C.', telefono: empresa.telefono ?? '',
      sitio_web: empresa.sitio_web ?? '', correo_seleccion: empresa.correo_seleccion ?? '', correo_datos: empresa.correo_datos ?? '',
      representante_legal: empresa.representante_legal ?? '', representante_documento: empresa.representante_documento ?? '',
      telefono_nomina: empresa.telefono_nomina ?? '', contacto_nomina: empresa.contacto_nomina ?? '',
    },
    hoy: {
      fecha: fechaCorta(hoy), fecha_larga: fechaLarga(hoy), dia: p2(hoy.getDate()), mes: p2(hoy.getMonth() + 1),
      mes_nombre: MESES[hoy.getMonth()], anio: String(hoy.getFullYear()), ciudad: empresa.ciudad ?? 'BOGOTÁ D.C.',
    },
    candidato: {
      tipo_documento: c.tipo_documento, tipo_documento_nombre: TIPO_DOC_NOMBRE[c.tipo_documento] ?? c.tipo_documento,
      numero_documento: c.numero_documento,
      numero_documento_puntos: /^\d+$/.test(String(c.numero_documento)) ? Number(c.numero_documento).toLocaleString('es-CO') : c.numero_documento,
      nombre_completo: nombresCompletos, apellidos_nombres: [c.apellidos, c.nombres].filter(Boolean).join(' '),
      nombres: c.nombres ?? '', apellidos: c.apellidos ?? '',
      primer_nombre: c.primer_nombre ?? '', segundo_nombre: c.segundo_nombre ?? '',
      primer_apellido: c.primer_apellido ?? '', segundo_apellido: c.segundo_apellido ?? '',
      fecha_nacimiento: c.fecha_nacimiento ?? '', edad: edadDesde(c.fecha_nacimiento, hoy) ?? '',
      municipio_nacimiento: mun.get(c.municipio_nacimiento) ?? '', departamento_nacimiento: dep.get(c.departamento_nacimiento) ?? '',
      lugar_nacimiento: lugarConDepto(mun.get(c.municipio_nacimiento), dep.get(c.departamento_nacimiento)),
      fecha_expedicion_doc: c.fecha_expedicion_doc ?? '', lugar_expedicion_doc: c.lugar_expedicion_doc ?? '',
      nacionalidad: c.nacionalidad ?? '', genero: c.genero ?? '', es_femenino: esFemenino, sexo_letra: esFemenino ? 'F' : (c.genero ? 'M' : ''),
      estado_civil: c.estado_civil ?? '', grupo_sanguineo: c.grupo_sanguineo ?? '', nivel_escolaridad: c.nivel_escolaridad ?? '',
      estatura_cm: c.estatura_cm ?? '', libreta_militar_tipo: c.libreta_militar_tipo ?? '',
      libreta_militar_numero: c.libreta_militar_numero ?? '', distrito_militar: c.distrito_militar ?? '',
      email: c.email ?? '', celular: c.celular ?? '', telefono_alterno: c.telefono_alterno ?? '', telefono_fijo: c.telefono_fijo ?? '',
      contacto_emergencia_nombre: c.contacto_emergencia_nombre ?? '', contacto_emergencia_parentesco: c.contacto_emergencia_parentesco ?? '',
      contacto_emergencia_telefono: c.contacto_emergencia_telefono ?? '',
      direccion, barrio: dir?.barrio ?? '', localidad: dir?.localidad ?? '', ciudad_residencia: ciudadRes,
      departamento_residencia: dir?.departamento_codigo ? (dep.get(dir.departamento_codigo) ?? '') : '',
      direccion_completa: [direccion, dir?.barrio, ciudadRes].filter(Boolean).join(', '),
      ciudad_trabajo: mun.get(c.municipio_trabajo) ?? '', departamento_trabajo: dep.get(c.departamento_trabajo) ?? '',
      eps: nombreDe(epsR, c.eps_id), afp: nombreDe(afpR, c.afp_id), cesantias: nombreDe(cesR, c.cesantias_id),
      caja: nombreDe(cajaR, c.ccf_id), banco: nombreDe(bancoR, c.banco_id), tipo_cuenta: c.tipo_cuenta ?? '',
      numero_cuenta: c.numero_cuenta ?? '', es_pensionado: !!c.es_pensionado,
      cargo: cargo?.nombre ?? '', cargo_carta: esFemenino && cargo?.nombre_femenino ? cargo.nombre_femenino : (cargo?.nombre ?? ''),
      experiencia_anios: c.experiencia_anios ?? 0, experiencia_meses: c.experiencia_meses ?? 0,
      experiencia_texto: experienciaTexto(c.experiencia_anios, c.experiencia_meses),
      talla_camisa: c.talla_camisa ?? '', talla_pantalon: c.talla_pantalon ?? '', talla_calzado: c.talla_calzado ?? '', talla_chaqueta: c.talla_chaqueta ?? '',
      tiene_personas_a_cargo: !!c.tiene_personas_a_cargo,
      numero_hijos: beneficiarios.filter((b: any) => /^hij/i.test(b.parentesco)).length,
      numero_personas_cargo: beneficiarios.length, beneficiarios,
      curso_alturas: c.curso_alturas, curso_alturas_vigencia: c.curso_alturas_vigencia ?? '',
      curso_alimentos: c.curso_alimentos, curso_alimentos_vigencia: c.curso_alimentos_vigencia ?? '', curso_grecas: c.curso_grecas,
      ha_trabajado_antes: c.ha_trabajado_antes, ha_hecho_proceso_antes: c.ha_hecho_proceso_antes,
      historial_laboral: (histR.data ?? []).map((h: any) => ({
        cargo: h.cargo ?? '', centro_costo: h.centro_costo ?? '', fecha_ingreso: h.fecha_ingreso ?? '', fecha_retiro: h.fecha_retiro ?? '',
      })),
      fuente_reclutamiento: c.fuente_reclutamiento ?? '', referido_por: c.referido_por ?? '',
      aspiracion_salarial: c.aspiracion_salarial ?? '', disponibilidad_jornada: c.disponibilidad_jornada ?? [],
      fecha_disponible: c.fecha_disponible ?? '', vivienda_tipo: c.vivienda_tipo ?? '', estrato: c.estrato ?? '',
      practica_deporte: c.practica_deporte, fecha_postulacion: String(c.created_at ?? '').slice(0, 10),
      perfil_laboral: c.perfil_laboral ?? '',
      estudios,
      estudio_primaria: primeroDe('PRIMARIA'), estudio_secundaria: primeroDe('SECUNDARIA'),
      estudio_tecnica: primeroDe('TECNICO', 'TECNOLOGO'), estudio_universitaria: primeroDe('UNIVERSITARIO', 'POSGRADO'),
      estudios_otros: estudios.filter((e: any) => e.nivel === 'CURSO'),
      experiencias,
      referencias_familiares: refs.filter((r: any) => r.tipo === 'FAMILIAR'),
      referencias_personales: refs.filter((r: any) => r.tipo === 'PERSONAL'),
      referencias_laborales: refs.filter((r: any) => r.tipo === 'LABORAL'),
    },
    cargo: {
      nombre: cargo?.nombre ?? '', nombre_carta: esFemenino && cargo?.nombre_femenino ? cargo.nombre_femenino : (cargo?.nombre ?? ''),
      tipo: cargo?.tipo ?? '', funciones_generales: cargo?.funciones_generales ?? [],
      funciones_especificas: cargo?.funciones_especificas ?? [], funciones_operativas: cargo?.funciones_operativas ?? [],
      requiere_manipulacion_alimentos: !!cargo?.requiere_manipulacion_alimentos, requiere_trabajo_alturas: !!cargo?.requiere_trabajo_alturas,
      requiere_curso_grecas: !!cargo?.requiere_curso_grecas,
    },
    contrato,
    requisicion: req ? {
      numero: req.numero, cliente_nombre: req.cliente_nombre ?? '', sede: req.sede ?? '',
      cargo: req.cargo_texto ?? cargo?.nombre ?? '', solicitante_nombre: req.solicitante_nombre ?? '',
    } : {},
    entrevista,
    politicas: (politR.data ?? []).map((p: any) => p.etiqueta),
    documentos: {
      lista: listaDocs,
      faltantes: listaDocs.filter((d: any) => d.obligatorio && !d.cargado).map((d: any) => d.nombre),
      total: (docsR.data ?? []).length,
    },
    parametros: { anio: params.anio ?? hoy.getFullYear(), smlv: params.smlv ?? '', auxilio_transporte: params.auxilio_transporte ?? '' },
    extras: { ...(op.extras ?? {}) },
  }
  return agregarFormato(contexto)
}

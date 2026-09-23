// Catálogo de variables disponibles en las plantillas de documentos.
//
// Es la referencia que ve RRHH en el editor de plantillas y, al mismo tiempo,
// el contrato que cumple `construirContexto()` (lib/documentos/contexto.ts).
// Si se agrega una variable, va en los dos sitios.

export interface VariableDoc {
  ruta: string
  descripcion: string
  ejemplo?: string
}

export interface GrupoVariables {
  grupo: string
  descripcion?: string
  variables: VariableDoc[]
}

export const GRUPOS_VARIABLES: GrupoVariables[] = [
  {
    grupo: 'empresa',
    descripcion: 'Datos del empleador (se administran en Configuración del ATS).',
    variables: [
      { ruta: 'empresa.razon_social', descripcion: 'Razón social', ejemplo: 'CONSERJES INMOBILIARIOS LTDA' },
      { ruta: 'empresa.nit', descripcion: 'NIT con dígito de verificación', ejemplo: '800.093.388-2' },
      { ruta: 'empresa.direccion', descripcion: 'Dirección de la sede administrativa', ejemplo: 'Carrera 19 No. 166 - 34' },
      { ruta: 'empresa.ciudad', descripcion: 'Ciudad de la empresa', ejemplo: 'BOGOTÁ D.C.' },
      { ruta: 'empresa.telefono', descripcion: 'Teléfono', ejemplo: '+57 1 674 1400' },
      { ruta: 'empresa.sitio_web', descripcion: 'Sitio web' },
      { ruta: 'empresa.correo_seleccion', descripcion: 'Correo del área de selección' },
      { ruta: 'empresa.correo_datos', descripcion: 'Correo para derechos de habeas data' },
      { ruta: 'empresa.representante_legal', descripcion: 'Nombre del representante legal' },
      { ruta: 'empresa.representante_documento', descripcion: 'Cédula del representante legal' },
      { ruta: 'empresa.telefono_nomina', descripcion: 'Teléfono / extensión de nómina', ejemplo: '6741400 ext. 304' },
      { ruta: 'empresa.contacto_nomina', descripcion: 'Persona de contacto en nómina' },
    ],
  },
  {
    grupo: 'hoy',
    descripcion: 'Fecha de generación del documento.',
    variables: [
      { ruta: 'hoy.fecha', descripcion: 'DD/MM/AAAA', ejemplo: '11/06/2026' },
      { ruta: 'hoy.fecha_larga', descripcion: 'En letras', ejemplo: '11 de junio de 2026' },
      { ruta: 'hoy.dia', descripcion: 'Día (2 dígitos)' },
      { ruta: 'hoy.mes', descripcion: 'Mes (2 dígitos)' },
      { ruta: 'hoy.mes_nombre', descripcion: 'Nombre del mes' },
      { ruta: 'hoy.anio', descripcion: 'Año' },
      { ruta: 'hoy.ciudad', descripcion: 'Ciudad donde se firma (la de la empresa)' },
    ],
  },
  {
    grupo: 'candidato',
    descripcion: 'Todo lo que el candidato llenó en el formulario.',
    variables: [
      { ruta: 'candidato.tipo_documento', descripcion: 'CC / CE / PPT…' },
      { ruta: 'candidato.tipo_documento_nombre', descripcion: 'Nombre largo del tipo de documento', ejemplo: 'Cédula de ciudadanía' },
      { ruta: 'candidato.numero_documento', descripcion: 'Número sin puntos', ejemplo: '1000123456' },
      { ruta: 'candidato.numero_documento_puntos', descripcion: 'Número con puntos', ejemplo: '1.000.123.456' },
      { ruta: 'candidato.nombre_completo', descripcion: 'Nombres y apellidos', ejemplo: 'LAURA MARCELA RÍOS PEÑA' },
      { ruta: 'candidato.apellidos_nombres', descripcion: 'Apellidos y nombres (como nómina)', ejemplo: 'RÍOS PEÑA LAURA MARCELA' },
      { ruta: 'candidato.nombres', descripcion: 'Nombres' },
      { ruta: 'candidato.apellidos', descripcion: 'Apellidos' },
      { ruta: 'candidato.primer_nombre', descripcion: 'Primer nombre' },
      { ruta: 'candidato.segundo_nombre', descripcion: 'Segundo nombre' },
      { ruta: 'candidato.primer_apellido', descripcion: 'Primer apellido' },
      { ruta: 'candidato.segundo_apellido', descripcion: 'Segundo apellido' },
      { ruta: 'candidato.fecha_nacimiento', descripcion: 'AAAA-MM-DD (usar | fecha o | fecha_larga)' },
      { ruta: 'candidato.edad', descripcion: 'Edad en años cumplidos' },
      { ruta: 'candidato.lugar_nacimiento', descripcion: 'Ciudad y departamento de nacimiento', ejemplo: 'SANTA ROSA DE CABAL (RISARALDA)' },
      { ruta: 'candidato.municipio_nacimiento', descripcion: 'Ciudad de nacimiento' },
      { ruta: 'candidato.departamento_nacimiento', descripcion: 'Departamento de nacimiento' },
      { ruta: 'candidato.fecha_expedicion_doc', descripcion: 'Fecha de expedición del documento' },
      { ruta: 'candidato.lugar_expedicion_doc', descripcion: 'Lugar de expedición del documento' },
      { ruta: 'candidato.nacionalidad', descripcion: 'Nacionalidad', ejemplo: 'COLOMBIANA' },
      { ruta: 'candidato.genero', descripcion: 'Género' },
      { ruta: 'candidato.es_femenino', descripcion: 'Verdadero si el género es femenino (para redacción)' },
      { ruta: 'candidato.sexo_letra', descripcion: 'F / M' },
      { ruta: 'candidato.estado_civil', descripcion: 'Estado civil' },
      { ruta: 'candidato.grupo_sanguineo', descripcion: 'Grupo sanguíneo y RH' },
      { ruta: 'candidato.nivel_escolaridad', descripcion: 'Nivel de escolaridad' },
      { ruta: 'candidato.estatura_cm', descripcion: 'Estatura en cm' },
      { ruta: 'candidato.libreta_militar_tipo', descripcion: 'Clase de libreta militar' },
      { ruta: 'candidato.libreta_militar_numero', descripcion: 'Número de libreta militar' },
      { ruta: 'candidato.distrito_militar', descripcion: 'Distrito militar' },
      { ruta: 'candidato.email', descripcion: 'Correo electrónico' },
      { ruta: 'candidato.celular', descripcion: 'Celular' },
      { ruta: 'candidato.telefono_alterno', descripcion: 'Teléfono alterno' },
      { ruta: 'candidato.contacto_emergencia_nombre', descripcion: 'Contacto de emergencia: nombre' },
      { ruta: 'candidato.contacto_emergencia_parentesco', descripcion: 'Contacto de emergencia: parentesco' },
      { ruta: 'candidato.contacto_emergencia_telefono', descripcion: 'Contacto de emergencia: teléfono' },
      { ruta: 'candidato.direccion', descripcion: 'Dirección de residencia vigente' },
      { ruta: 'candidato.barrio', descripcion: 'Barrio' },
      { ruta: 'candidato.localidad', descripcion: 'Localidad / comuna' },
      { ruta: 'candidato.ciudad_residencia', descripcion: 'Ciudad de residencia' },
      { ruta: 'candidato.departamento_residencia', descripcion: 'Departamento de residencia' },
      { ruta: 'candidato.direccion_completa', descripcion: 'Dirección, barrio y ciudad en una línea' },
      { ruta: 'candidato.ciudad_trabajo', descripcion: 'Ciudad donde desea trabajar' },
      { ruta: 'candidato.departamento_trabajo', descripcion: 'Departamento donde desea trabajar' },
      { ruta: 'candidato.eps', descripcion: 'EPS' },
      { ruta: 'candidato.afp', descripcion: 'Fondo de pensión' },
      { ruta: 'candidato.cesantias', descripcion: 'Fondo de cesantías' },
      { ruta: 'candidato.caja', descripcion: 'Caja de compensación' },
      { ruta: 'candidato.banco', descripcion: 'Banco' },
      { ruta: 'candidato.tipo_cuenta', descripcion: 'Tipo de cuenta' },
      { ruta: 'candidato.numero_cuenta', descripcion: 'Número de cuenta' },
      { ruta: 'candidato.es_pensionado', descripcion: 'Verdadero si es pensionado' },
      { ruta: 'candidato.cargo', descripcion: 'Cargo al que se postuló' },
      { ruta: 'candidato.cargo_carta', descripcion: 'Cargo en femenino si aplica (para cartas)', ejemplo: 'OPERARIA DE ASEO Y CAFETERÍA' },
      { ruta: 'candidato.experiencia_anios', descripcion: 'Años de experiencia' },
      { ruta: 'candidato.experiencia_meses', descripcion: 'Meses de experiencia' },
      { ruta: 'candidato.experiencia_texto', descripcion: '"7 años y 3 meses"' },
      { ruta: 'candidato.talla_camisa', descripcion: 'Talla camisa' },
      { ruta: 'candidato.talla_pantalon', descripcion: 'Talla pantalón' },
      { ruta: 'candidato.talla_calzado', descripcion: 'Talla calzado' },
      { ruta: 'candidato.talla_chaqueta', descripcion: 'Talla chaqueta' },
      { ruta: 'candidato.tiene_personas_a_cargo', descripcion: 'Verdadero si tiene personas a cargo' },
      { ruta: 'candidato.numero_hijos', descripcion: 'Cantidad de hijos registrados' },
      { ruta: 'candidato.numero_personas_cargo', descripcion: 'Cantidad de beneficiarios' },
      { ruta: 'candidato.beneficiarios', descripcion: 'Lista: nombre_completo, parentesco, tipo_documento, numero_documento, fecha_nacimiento, edad' },
      { ruta: 'candidato.curso_alturas', descripcion: 'Tiene curso de alturas (Sí/No)' },
      { ruta: 'candidato.curso_alturas_vigencia', descripcion: 'Vence el (curso de alturas)' },
      { ruta: 'candidato.curso_alimentos', descripcion: 'Tiene curso de manipulación de alimentos' },
      { ruta: 'candidato.curso_grecas', descripcion: 'Tiene curso de manejo de grecas' },
      { ruta: 'candidato.ha_trabajado_antes', descripcion: 'Ya trabajó con la empresa' },
      { ruta: 'candidato.ha_hecho_proceso_antes', descripcion: 'Ya hizo el proceso antes' },
      { ruta: 'candidato.historial_laboral', descripcion: 'Lista de vinculaciones previas en la empresa: cargo, centro_costo, fecha_ingreso, fecha_retiro' },
      { ruta: 'candidato.fuente_reclutamiento', descripcion: 'Cómo se enteró de la vacante' },
      { ruta: 'candidato.referido_por', descripcion: 'Quién lo refirió' },
      { ruta: 'candidato.aspiracion_salarial', descripcion: 'Aspiración salarial' },
      { ruta: 'candidato.disponibilidad_jornada', descripcion: 'Jornadas disponibles (lista)' },
      { ruta: 'candidato.fecha_disponible', descripcion: 'Desde cuándo puede iniciar' },
      { ruta: 'candidato.vivienda_tipo', descripcion: 'Tipo de vivienda' },
      { ruta: 'candidato.estrato', descripcion: 'Estrato' },
      { ruta: 'candidato.practica_deporte', descripcion: 'Practica deporte' },
      { ruta: 'candidato.fecha_postulacion', descripcion: 'Fecha en que envió el registro' },
      { ruta: 'candidato.perfil_laboral', descripcion: 'Perfil laboral escrito por el candidato (si lo hay)' },
      { ruta: 'candidato.telefono_fijo', descripcion: 'Teléfono fijo' },
      { ruta: 'candidato.estudios', descripcion: 'Lista: nivel, institucion, titulo, anio_finalizacion, ultimo_curso_aprobado, ciudad, en_curso' },
      { ruta: 'candidato.estudio_primaria', descripcion: 'Objeto: institucion, anio_finalizacion, ultimo_curso_aprobado, titulo, ciudad' },
      { ruta: 'candidato.estudio_secundaria', descripcion: 'Bachillerato (mismos campos)' },
      { ruta: 'candidato.estudio_tecnica', descripcion: 'Técnico o tecnólogo (mismos campos)' },
      { ruta: 'candidato.estudio_universitaria', descripcion: 'Universitario o posgrado (mismos campos)' },
      { ruta: 'candidato.estudios_otros', descripcion: 'Cursos y educación no formal (lista)' },
      { ruta: 'candidato.experiencias', descripcion: 'Lista de empleos: empresa, cargo, direccion, telefono, jefe_inmediato, cargo_jefe, fecha_ingreso, fecha_retiro, motivo_retiro, funciones, tiempo_laborado' },
      { ruta: 'candidato.referencias_familiares', descripcion: 'Lista: nombre, parentesco, telefono, direccion, ocupacion, empresa' },
      { ruta: 'candidato.referencias_personales', descripcion: 'Lista: nombre, ocupacion, telefono, direccion, empresa' },
      { ruta: 'candidato.referencias_laborales', descripcion: 'Lista de referencias laborales' },
    ],
  },
  {
    grupo: 'formato',
    descripcion: 'Listas completadas con filas vacías hasta el número de renglones del formato impreso.',
    variables: [
      { ruta: 'formato.referencias_familiares', descripcion: '2 renglones' },
      { ruta: 'formato.referencias_personales', descripcion: '2 renglones' },
      { ruta: 'formato.experiencias', descripcion: '2 renglones (Actualización de datos)' },
      { ruta: 'formato.experiencias3', descripcion: '3 renglones (hoja de vida, entrevista)' },
      { ruta: 'formato.estudios_otros', descripcion: '4 renglones de educación no formal' },
      { ruta: 'formato.beneficiarios', descripcion: '6 renglones de grupo familiar' },
      { ruta: 'formato.convivientes', descripcion: '6 renglones de "con quién vive" (entrevista)' },
      { ruta: 'formato.trayectoria', descripcion: '3 renglones de trayectoria laboral (entrevista)' },
    ],
  },
  {
    grupo: 'cargo',
    descripcion: 'Cargo del contrato (o el postulado si aún no hay contrato).',
    variables: [
      { ruta: 'cargo.nombre', descripcion: 'Nombre del cargo', ejemplo: 'OPERARIO ASEO Y CAFETERIA' },
      { ruta: 'cargo.nombre_carta', descripcion: 'Nombre en femenino si el candidato es mujer y existe' },
      { ruta: 'cargo.tipo', descripcion: 'OPERATIVO / ADMINISTRATIVO' },
      { ruta: 'cargo.funciones_generales', descripcion: 'Lista (usar | vinetas o #each)' },
      { ruta: 'cargo.funciones_especificas', descripcion: 'Lista' },
      { ruta: 'cargo.funciones_operativas', descripcion: 'Lista' },
      { ruta: 'cargo.requiere_manipulacion_alimentos', descripcion: 'Verdadero/Falso' },
      { ruta: 'cargo.requiere_trabajo_alturas', descripcion: 'Verdadero/Falso' },
      { ruta: 'cargo.requiere_curso_grecas', descripcion: 'Verdadero/Falso' },
    ],
  },
  {
    grupo: 'contrato',
    descripcion: 'Condiciones del contrato de trabajo (solo cuando ya existe).',
    variables: [
      { ruta: 'contrato.existe', descripcion: 'Verdadero si hay contrato' },
      { ruta: 'contrato.codigo', descripcion: 'Consecutivo', ejemplo: 'CONS20260613-001' },
      { ruta: 'contrato.tipo_contrato', descripcion: 'OBRA_LABOR / TERMINO_FIJO / INDEFINIDO' },
      { ruta: 'contrato.tipo_contrato_nombre', descripcion: 'Nombre largo de la modalidad' },
      { ruta: 'contrato.fecha_inicio_labores', descripcion: 'Fecha de iniciación de labores' },
      { ruta: 'contrato.salario', descripcion: 'Salario en número (usar | moneda)' },
      { ruta: 'contrato.salario_texto', descripcion: 'Salario como se imprime en la minuta', ejemplo: 'Mínimo Legal Vigente más Auxilio de Transporte y Recargos de Ley' },
      { ruta: 'contrato.periodo_pago', descripcion: 'Periodo de pago' },
      { ruta: 'contrato.lugar_labores', descripcion: 'Lugar donde desempeñará las labores' },
      { ruta: 'contrato.ciudad_contratacion', descripcion: 'Ciudad donde ha sido contratado' },
      { ruta: 'contrato.contrato_servicio', descripcion: 'Contrato de servicio / obra que origina la labor' },
      { ruta: 'contrato.centro_costo', descripcion: 'Código del centro de costos' },
      { ruta: 'contrato.centro_costo_nombre', descripcion: 'Nombre del centro de costos' },
      { ruta: 'contrato.periodo_prueba_dias', descripcion: 'Días del periodo de prueba' },
      { ruta: 'contrato.periodo_prueba_texto', descripcion: '"dos (2) meses"' },
      { ruta: 'contrato.fecha_fin_periodo_prueba', descripcion: 'Fin del periodo de prueba' },
      { ruta: 'contrato.fecha_fin_contrato', descripcion: 'Fin del contrato (si aplica)' },
      { ruta: 'contrato.modalidad_jornada', descripcion: 'Jornada' },
      { ruta: 'contrato.ciudad_firma', descripcion: 'Ciudad de firma' },
      { ruta: 'contrato.fecha_firma', descripcion: 'Fecha de firma' },
      { ruta: 'contrato.testigo1_nombre', descripcion: 'Testigo 1' },
      { ruta: 'contrato.testigo1_documento', descripcion: 'C.C. testigo 1' },
      { ruta: 'contrato.testigo2_nombre', descripcion: 'Testigo 2' },
      { ruta: 'contrato.testigo2_documento', descripcion: 'C.C. testigo 2' },
      { ruta: 'contrato.clausulas_adicionales', descripcion: 'Lista de cláusulas adicionales' },
      { ruta: 'contrato.arl', descripcion: 'ARL' },
      { ruta: 'contrato.eps', descripcion: 'EPS del contrato' },
      { ruta: 'contrato.afp', descripcion: 'AFP del contrato' },
      { ruta: 'contrato.cesantias', descripcion: 'Fondo de cesantías' },
      { ruta: 'contrato.caja', descripcion: 'Caja de compensación' },
      { ruta: 'contrato.observaciones', descripcion: 'Observaciones' },
    ],
  },
  {
    grupo: 'requisicion',
    descripcion: 'Requisición de personal que originó la vacante (si se asignó).',
    variables: [
      { ruta: 'requisicion.numero', descripcion: 'Número de requisición' },
      { ruta: 'requisicion.cliente_nombre', descripcion: 'Cliente / contrato' },
      { ruta: 'requisicion.sede', descripcion: 'Sede' },
      { ruta: 'requisicion.cargo', descripcion: 'Cargo solicitado' },
      { ruta: 'requisicion.solicitante_nombre', descripcion: 'Quien solicitó' },
    ],
  },
  {
    grupo: 'entrevista',
    descripcion: 'Campos de la evaluación tipo ENTREVISTA registrada por RRHH.',
    variables: [
      { ruta: 'entrevista.existe', descripcion: 'Verdadero si hay entrevista registrada' },
      { ruta: 'entrevista.fecha', descripcion: 'Fecha de la entrevista' },
      { ruta: 'entrevista.evaluador_nombre', descripcion: 'Psicólogo(a) / evaluador' },
      { ruta: 'entrevista.convivientes', descripcion: 'Lista: nombre, parentesco, edad, nivel_academico, ocupacion' },
      { ruta: 'entrevista.vive_solo', descripcion: 'Verdadero si en la entrevista se marcó que vive solo(a)' },
      { ruta: 'entrevista.personas_a_cargo', descripcion: 'Texto' },
      { ruta: 'entrevista.aspectos_mejorar', descripcion: 'Texto' },
      { ruta: 'entrevista.aspectos_buenos', descripcion: 'Texto' },
      { ruta: 'entrevista.tiempo_libre', descripcion: 'Texto' },
      { ruta: 'entrevista.grupo_social', descripcion: 'Texto' },
      { ruta: 'entrevista.metas', descripcion: 'Texto' },
      { ruta: 'entrevista.trayectoria', descripcion: 'Lista: empresa, tiempo, fecha_retiro, razon_retiro, funciones' },
      { ruta: 'entrevista.logros', descripcion: 'Texto' },
      { ruta: 'entrevista.situacion_dificil', descripcion: 'Texto' },
      { ruta: 'entrevista.solucion', descripcion: 'Texto' },
      { ruta: 'entrevista.aprendizaje', descripcion: 'Texto' },
      { ruta: 'entrevista.personal_a_cargo', descripcion: 'Texto' },
      { ruta: 'entrevista.personal_dificil', descripcion: 'Texto' },
      { ruta: 'entrevista.concepto_general', descripcion: 'Concepto general (uso interno)' },
      { ruta: 'entrevista.observaciones', descripcion: 'Observaciones (uso interno)' },
    ],
  },
  {
    grupo: 'politicas',
    descripcion: 'Lista de políticas organizacionales vigentes (catálogo).',
    variables: [{ ruta: 'politicas', descripcion: 'Lista de nombres (usar | vinetas o #each)' }],
  },
  {
    grupo: 'documentos',
    descripcion: 'Estado del expediente documental.',
    variables: [
      { ruta: 'documentos.lista', descripcion: 'Lista de tipos documentales: nombre, obligatorio, cargado, descripcion' },
      { ruta: 'documentos.faltantes', descripcion: 'Lista de nombres de documentos obligatorios que faltan' },
      { ruta: 'documentos.total', descripcion: 'Cantidad de archivos cargados' },
    ],
  },
  {
    grupo: 'parametros',
    descripcion: 'Parámetros legales del año.',
    variables: [
      { ruta: 'parametros.anio', descripcion: 'Año de vigencia' },
      { ruta: 'parametros.smlv', descripcion: 'Salario mínimo (usar | moneda)' },
      { ruta: 'parametros.auxilio_transporte', descripcion: 'Auxilio de transporte' },
    ],
  },
  {
    grupo: 'extras',
    descripcion: 'Valores que se piden al generar (varían por documento).',
    variables: [
      { ruta: 'extras.plazo_dias', descripcion: 'Días de plazo para completar documentos', ejemplo: '8' },
      { ruta: 'extras.pagare_valor', descripcion: 'Valor del pagaré (vacío = "X")' },
      { ruta: 'extras.descuento_valor', descripcion: 'Cuantía del descuento autorizado' },
      { ruta: 'extras.responsable_nombre', descripcion: 'Quien socializa / recibe (RRHH)' },
      { ruta: 'extras.responsable_cargo', descripcion: 'Cargo de quien socializa' },
      { ruta: 'extras.evaluador_nombre', descripcion: 'Psicólogo(a) evaluador(a)' },
      { ruta: 'extras.puesto_direccion', descripcion: 'Dirección del puesto de trabajo' },
      { ruta: 'extras.puesto_telefono', descripcion: 'Teléfono del puesto de trabajo' },
      { ruta: 'extras.puesto_interventor', descripcion: 'Nombre del interventor / supervisor del cliente' },
    ],
  },
]

/** Etiquetas legibles para pedir los `extras` al generar. */
export const ETIQUETAS_EXTRAS: Record<string, string> = Object.fromEntries(
  (GRUPOS_VARIABLES.find((g) => g.grupo === 'extras')?.variables ?? []).map((v) => [v.ruta.replace(/^extras\./, ''), v.descripcion]),
)

export const MARCADORES_DOC = [
  { marcador: '{{FIRMA_TRABAJADOR}}', descripcion: 'Donde va la firma del trabajador (se estampa al firmar en pantalla; en papel queda la línea).' },
  { marcador: '{{FECHA_FIRMA}}', descripcion: 'Fecha y hora en que firmó en la plataforma.' },
  { marcador: '{{HUELLA}}', descripcion: 'Recuadro para la huella índice derecho.' },
  { marcador: '{{HUELLA_IZQUIERDA}}', descripcion: 'Recuadro para la huella índice izquierdo.' },
  { marcador: '{{FOTO_CARNET}}', descripcion: 'Foto tipo carnet del candidato (se resuelve al ver el documento).' },
  { marcador: '{{FIRMA_EMPLEADOR}}', descripcion: 'Firma del representante legal (línea o imagen configurada).' },
  { marcador: '{{FIRMA_TESTIGO1}}', descripcion: 'Firma del testigo 1.' },
  { marcador: '{{FIRMA_TESTIGO2}}', descripcion: 'Firma del testigo 2.' },
  { marcador: '{{FIRMA_RESPONSABLE}}', descripcion: 'Firma del responsable de RRHH (socialización / recibido).' },
  { marcador: '{{FIRMA_EVALUADOR}}', descripcion: 'Firma del psicólogo(a) evaluador(a).' },
]

export const FILTROS_DOC = [
  { filtro: 'mayusculas', descripcion: 'MAYÚSCULAS' },
  { filtro: 'minusculas', descripcion: 'minúsculas' },
  { filtro: 'capitalizar', descripcion: 'Primera Letra De Cada Palabra' },
  { filtro: 'fecha', descripcion: 'DD/MM/AAAA' },
  { filtro: 'fecha_larga', descripcion: '11 de junio de 2026' },
  { filtro: 'dia / mes / anio / mes_nombre', descripcion: 'Partes de una fecha' },
  { filtro: 'edad', descripcion: 'Años cumplidos desde una fecha' },
  { filtro: 'moneda', descripcion: '$ 1.423.500' },
  { filtro: 'numero', descripcion: '1.423.500' },
  { filtro: 'puntos', descripcion: 'Cédula con puntos: 1.054.989.561' },
  { filtro: 'letras', descripcion: 'Número en letras: uno, dos, mil…' },
  { filtro: 'si_no', descripcion: 'Sí / No' },
  { filtro: 'x', descripcion: '"X" si es verdadero (casillas)' },
  { filtro: 'defecto:"—"', descripcion: 'Texto cuando está vacío' },
  { filtro: 'lista', descripcion: 'Elementos separados por coma' },
  { filtro: 'lineas', descripcion: 'Elementos uno por línea' },
  { filtro: 'vinetas', descripcion: 'Elementos como lista con viñetas' },
  { filtro: 'igual:"CC"', descripcion: 'Verdadero si el valor es igual (combínelo con | x para casillas)' },
  { filtro: 'distinto:"CC"', descripcion: 'Verdadero si el valor es distinto' },
  { filtro: 'contiene:"8HD_LV"', descripcion: 'Verdadero si la lista (o el texto) contiene el valor' },
]

/** Todas las rutas del catálogo (para validar plantillas). */
export const RUTAS_CONOCIDAS = new Set(GRUPOS_VARIABLES.flatMap((g) => g.variables.map((v) => v.ruta)))

/** Completa una lista con filas vacías hasta `n` (renglones del formato impreso). */
export function rellenar<T extends object>(lista: T[] | undefined | null, n: number): Array<T | Record<string, never>> {
  const base: Array<T | Record<string, never>> = [...(lista ?? [])]
  while (base.length < n) base.push({})
  return base
}

/** Agrega el grupo `formato` (listas con renglones fijos) a partir del candidato y la entrevista. */
export function agregarFormato(ctx: Record<string, unknown>): Record<string, unknown> {
  const c = (ctx.candidato ?? {}) as Record<string, unknown>
  const e = (ctx.entrevista ?? {}) as Record<string, unknown>
  const lista = (v: unknown) => (Array.isArray(v) ? (v as object[]) : [])
  return {
    ...ctx,
    formato: {
      referencias_familiares: rellenar(lista(c.referencias_familiares), 2),
      referencias_personales: rellenar(lista(c.referencias_personales), 2),
      experiencias: rellenar(lista(c.experiencias), 2),
      experiencias3: rellenar(lista(c.experiencias), 3),
      estudios_otros: rellenar(lista(c.estudios_otros), 4),
      beneficiarios: rellenar(lista(c.beneficiarios), 6),
      convivientes: rellenar(lista(e.convivientes), 6),
      trayectoria: rellenar(lista(e.trayectoria), 3),
    },
  }
}

/**
 * Contexto de ejemplo para previsualizar plantillas en el editor.
 *
 * Todos los datos son FICTICIOS. No copiar aquí datos de expedientes reales:
 * este archivo va al repositorio y se muestra a cualquiera que abra el editor.
 */
export function contextoDeEjemplo(): Record<string, unknown> {
  const base = contextoBaseEjemplo()
  const c = base.candidato as Record<string, unknown>
  Object.assign(c, {
    telefono_fijo: '',
    estudios: [
      { nivel: 'PRIMARIA', institucion: 'Colegio Departamental de Ejemplo', titulo: 'Primaria', anio_finalizacion: 2004, ultimo_curso_aprobado: '5°', ciudad: 'SANTA ROSA DE CABAL' },
      { nivel: 'SECUNDARIA', institucion: 'Colegio Departamental de Ejemplo', titulo: 'Bachiller académico', anio_finalizacion: 2010, ultimo_curso_aprobado: '11°', ciudad: 'SANTA ROSA DE CABAL' },
      { nivel: 'CURSO', institucion: 'Instituto de Capacitación de Ejemplo', titulo: 'Manipulación de alimentos (10 horas)', anio_finalizacion: 2026, ultimo_curso_aprobado: '', ciudad: 'BOGOTÁ D.C.' },
    ],
    estudio_primaria: { institucion: 'Colegio Departamental de Ejemplo', anio_finalizacion: 2004, ultimo_curso_aprobado: '5°', titulo: 'Primaria', ciudad: 'SANTA ROSA DE CABAL' },
    estudio_secundaria: { institucion: 'Colegio Departamental de Ejemplo', anio_finalizacion: 2010, ultimo_curso_aprobado: '11°', titulo: 'Bachiller académico', ciudad: 'SANTA ROSA DE CABAL' },
    estudio_tecnica: {},
    estudio_universitaria: {},
    estudios_otros: [{ institucion: 'Instituto de Capacitación de Ejemplo', titulo: 'Manipulación de alimentos (10 horas)', anio_finalizacion: 2026, ultimo_curso_aprobado: '' }],
    experiencias: [
      { empresa: 'SERVICIOS DE ASEO DEL NORTE S.A.S.', cargo: 'Operaria de aseo', direccion: 'Calle 100 # 10-10', telefono: '6010000000', jefe_inmediato: 'Jefe de Ejemplo', cargo_jefe: 'Supervisor', fecha_ingreso: '2024-10-03', fecha_retiro: '2026-06-12', motivo_retiro: 'Terminación de la obra o labor', funciones: 'Limpieza y desinfección de oficinas', tiempo_laborado: '1 año y 8 meses' },
      { empresa: 'LIMPIEZA INTEGRAL DE EJEMPLO LTDA', cargo: 'Auxiliar de servicios generales', direccion: 'Carrera 20 # 30-40', telefono: '6010000001', jefe_inmediato: 'Coordinadora de Ejemplo', cargo_jefe: 'Coordinadora', fecha_ingreso: '2023-08-01', fecha_retiro: '2024-08-02', motivo_retiro: 'Renuncia voluntaria', funciones: 'Aseo de áreas comunes', tiempo_laborado: '1 año' },
    ],
    referencias_familiares: [
      { nombre: 'ANA LUCÍA RÍOS PEÑA', parentesco: 'Hermana', telefono: '3000000011', direccion: 'Pereira, Risaralda', ocupacion: 'Comerciante', empresa: '' },
      { nombre: 'CARLOS ANDRÉS RÍOS PEÑA', parentesco: 'Hermano', telefono: '3000000012', direccion: 'Bogotá D.C.', ocupacion: 'Conductor', empresa: '' },
    ],
    referencias_personales: [
      { nombre: 'PEDRO PABLO PÉREZ', parentesco: 'Vecino', telefono: '3000000013', direccion: 'Calle 1 # 2-35', ocupacion: 'Independiente', empresa: '' },
      { nombre: 'LUISA FERNANDA MARTÍNEZ', parentesco: 'Amiga', telefono: '3000000014', direccion: 'Barrio Ejemplo', ocupacion: 'Docente', empresa: '' },
    ],
    referencias_laborales: [],
  })
  Object.assign(base.extras as Record<string, unknown>, { puesto_direccion: 'Sede principal del cliente', puesto_telefono: '', puesto_interventor: '' })
  return agregarFormato(base)
}

function contextoBaseEjemplo(): Record<string, unknown> {
  return {
    empresa: {
      razon_social: 'CONSERJES INMOBILIARIOS LTDA', nit: '800.093.388-2', direccion: 'Carrera 19 No. 166 - 34',
      ciudad: 'BOGOTÁ D.C.', telefono: '+57 1 674 1400', sitio_web: 'www.conserjesinmobiliarios.com',
      correo_seleccion: 'seleccion@conserjesinmobiliarios.com', correo_datos: 'vigicoladmon@hotmail.com',
      representante_legal: '', representante_documento: '', telefono_nomina: '6741400 ext. 304', contacto_nomina: 'Contacto de nómina',
    },
    hoy: { fecha: '11/06/2026', fecha_larga: '11 de junio de 2026', dia: '11', mes: '06', mes_nombre: 'junio', anio: '2026', ciudad: 'BOGOTÁ D.C.' },
    candidato: {
      tipo_documento: 'CC', tipo_documento_nombre: 'Cédula de ciudadanía', numero_documento: '1000123456', numero_documento_puntos: '1.000.123.456',
      nombre_completo: 'LAURA MARCELA RÍOS PEÑA', apellidos_nombres: 'RÍOS PEÑA LAURA MARCELA', nombres: 'LAURA MARCELA', apellidos: 'RÍOS PEÑA',
      primer_nombre: 'LAURA', segundo_nombre: 'MARCELA', primer_apellido: 'RÍOS', segundo_apellido: 'PEÑA',
      fecha_nacimiento: '1992-03-15', edad: 34, lugar_nacimiento: 'SANTA ROSA DE CABAL (RISARALDA)', municipio_nacimiento: 'SANTA ROSA DE CABAL', departamento_nacimiento: 'RISARALDA',
      fecha_expedicion_doc: '2010-04-20', lugar_expedicion_doc: 'SANTA ROSA DE CABAL', nacionalidad: 'COLOMBIANA', genero: 'Femenino', es_femenino: true, sexo_letra: 'F',
      estado_civil: 'Unión libre', grupo_sanguineo: 'O+', nivel_escolaridad: 'Bachiller', estatura_cm: 160,
      libreta_militar_tipo: 'No aplica', libreta_militar_numero: '', distrito_militar: '',
      email: 'laura.rios@ejemplo.com', celular: '3000000010', telefono_alterno: '',
      contacto_emergencia_nombre: 'ANA LUCÍA RÍOS PEÑA', contacto_emergencia_parentesco: 'Hermano(a)', contacto_emergencia_telefono: '3000000011',
      direccion: 'Calle 1 # 2-34', barrio: 'Barrio Ejemplo', localidad: 'Suba', ciudad_residencia: 'BOGOTÁ D.C.', departamento_residencia: 'BOGOTÁ D.C.',
      direccion_completa: 'Calle 1 # 2-34, Barrio Ejemplo, BOGOTÁ D.C.', ciudad_trabajo: 'BOGOTÁ D.C.', departamento_trabajo: 'BOGOTÁ D.C.',
      eps: 'SALUD TOTAL EPS', afp: 'PORVENIR', cesantias: 'PORVENIR', caja: 'COMPENSAR', banco: 'BANCOLOMBIA', tipo_cuenta: 'Ahorros', numero_cuenta: '00000000000', es_pensionado: false,
      cargo: 'OPERARIO ASEO Y CAFETERIA', cargo_carta: 'OPERARIA DE ASEO Y CAFETERÍA', experiencia_anios: 5, experiencia_meses: 6, experiencia_texto: '5 años y 6 meses',
      talla_camisa: 'M', talla_pantalon: '10', talla_calzado: '37', talla_chaqueta: 'M',
      tiene_personas_a_cargo: true, numero_hijos: 2, numero_personas_cargo: 2,
      beneficiarios: [
        { nombre_completo: 'SANTIAGO GÓMEZ RÍOS', parentesco: 'Hijo(a)', tipo_documento: 'TI', numero_documento: '1000000001', fecha_nacimiento: '2012-03-04', edad: 14 },
        { nombre_completo: 'VALENTINA GÓMEZ RÍOS', parentesco: 'Hijo(a)', tipo_documento: 'RC', numero_documento: '1000000002', fecha_nacimiento: '2018-05-10', edad: 8 },
      ],
      curso_alturas: false, curso_alturas_vigencia: '', curso_alimentos: true, curso_grecas: true,
      ha_trabajado_antes: false, ha_hecho_proceso_antes: false,
      historial_laboral: [],
      fuente_reclutamiento: 'Referido', referido_por: '', aspiracion_salarial: 1623500, disponibilidad_jornada: ['Diurna', 'Turnos rotativos'], fecha_disponible: '2026-06-13',
      vivienda_tipo: 'Arriendo', estrato: 2, practica_deporte: false, fecha_postulacion: '2026-06-01', perfil_laboral: 'Persona responsable y puntual, con experiencia en aseo de oficinas y cafetería.',
    },
    cargo: {
      nombre: 'OPERARIO ASEO Y CAFETERIA', nombre_carta: 'OPERARIA DE ASEO Y CAFETERÍA', tipo: 'OPERATIVO',
      funciones_generales: ['Mantener en óptimas condiciones de limpieza, orden e higiene las instalaciones.', 'Garantizar un ambiente limpio, seguro y agradable.'],
      funciones_especificas: ['Realizar la limpieza y desinfección de las áreas asignadas.', 'Preparar y servir bebidas y refrigerios cuando se requiera.'],
      funciones_operativas: ['Barrer, trapear, limpiar y desinfectar las áreas asignadas.', 'Vaciar canecas y cambiar bolsas de residuos.'],
      requiere_manipulacion_alimentos: true, requiere_trabajo_alturas: false, requiere_curso_grecas: true,
    },
    contrato: {
      existe: true, codigo: 'CONS20260613-001', tipo_contrato: 'OBRA_LABOR', tipo_contrato_nombre: 'Por la duración de una obra o labor determinada',
      fecha_inicio_labores: '2026-06-13', salario: 1623500, salario_texto: 'Mínimo Legal Vigente más Auxilio de Transporte y Recargos de Ley',
      periodo_pago: 'MES VENCIDO (QUINTO DÍA HÁBIL DE CADA MES)', lugar_labores: 'BOGOTÁ', ciudad_contratacion: 'BOGOTÁ',
      contrato_servicio: 'CONTRATO DE SERVICIO DE ASEO, CAFETERÍA Y MANTENIMIENTO No. 000-2026 CON CLIENTE DE EJEMPLO S.A.',
      centro_costo: 'CLIENTE EJEMPLO 2026-BOGOTA', centro_costo_nombre: 'CLIENTE EJEMPLO 2026', periodo_prueba_dias: 60, periodo_prueba_texto: 'los primeros dos (2) meses calendario de labores',
      fecha_fin_periodo_prueba: '2026-08-11', fecha_fin_contrato: '', modalidad_jornada: 'JORNADA MÁXIMA LEGAL', ciudad_firma: 'BOGOTÁ', fecha_firma: '2026-06-13',
      testigo1_nombre: '', testigo1_documento: '', testigo2_nombre: '', testigo2_documento: '',
      clausulas_adicionales: [
        'Sin perjuicio de las cláusulas sexta y séptima del presente contrato, este se dará por terminado en caso de que el usuario solicite su cambio o traslado por mal servicio, o por cualquier otro motivo.',
      ],
      arl: 'AXA COLPATRIA ARL', eps: 'SALUD TOTAL EPS', afp: 'PORVENIR', cesantias: 'PORVENIR', caja: 'COMPENSAR', observaciones: '',
    },
    requisicion: { numero: 'REQ-2026-0001', cliente_nombre: 'CLIENTE DE EJEMPLO', sede: 'SEDE PRINCIPAL', cargo: 'OPERARIO ASEO', solicitante_nombre: 'Líder de operaciones' },
    entrevista: {
      existe: true, fecha: '2026-06-05', evaluador_nombre: 'Psicóloga evaluadora',
      convivientes: [{ nombre: 'Santiago Gómez Ríos', parentesco: 'Hijo', edad: '14', nivel_academico: 'Bachillerato', ocupacion: 'Estudiante' }],
      personas_a_cargo: 'Dos hijos', aspectos_mejorar: 'Manejo del tiempo', aspectos_buenos: 'Responsable y puntual', tiempo_libre: 'Compartir en familia',
      grupo_social: 'No', metas: 'Estudiar un técnico', trayectoria: [{ empresa: 'SERVICIOS DE ASEO DEL NORTE S.A.S.', tiempo: '1 año y 8 meses', fecha_retiro: '2026-06-12', razon_retiro: 'Terminación de la obra', funciones: 'Aseo de oficinas' }],
      logros: 'Reconocimiento por puntualidad', situacion_dificil: 'Un derrame químico', solucion: 'Siguió el protocolo', aprendizaje: 'Importancia de los EPP',
      personal_a_cargo: 'No', personal_dificil: '', concepto_general: 'Apta para el cargo', observaciones: '',
    },
    politicas: ['Política Integral', 'Política de Protección de Datos', 'Política de Buen Trato'],
    documentos: {
      lista: [{ nombre: 'Cédula de ciudadanía (ambas caras)', obligatorio: true, cargado: true, descripcion: '' }, { nombre: 'Certificado RNMC', obligatorio: true, cargado: false, descripcion: 'No mayor a 30 días' }],
      faltantes: ['Certificado RNMC'], total: 12,
    },
    parametros: { anio: 2026, smlv: 1623500, auxilio_transporte: 231000 },
    extras: { plazo_dias: 8, pagare_valor: '', descuento_valor: '', responsable_nombre: '', responsable_cargo: 'Analista de selección y contratación', evaluador_nombre: 'Psicóloga evaluadora' },
  }
}

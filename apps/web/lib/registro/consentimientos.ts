// Textos legales versionados de consentimiento (Ley 1581/2012, Decreto 1377/2013).
// La PRUEBA de la autorización es carga del responsable (Art. 9): por eso cada
// consentimiento se persiste con texto_version + texto_hash + ip + user_agent.
//
// ❗ VERIFICAR con el área jurídica antes de producción:
//   - NIT y dígito de verificación (el sitio web publica 800093388-2; la minuta
//     imprime 800093388-3 / 800093388-324 malformado).
//   - Correo de PQRS de datos personales.

export const EMPRESA = {
  razon_social: 'CONSERJES INMOBILIARIOS LTDA',
  nit: '800093388-2', // ❗ VERIFICAR (ver nota arriba)
  direccion: 'Carrera 19 No. 166 – 34, Bogotá D.C.',
  email_pqrs: 'protecciondedatos@conserjesinmobiliarios.com', // ❗ VERIFICAR
  telefono: '320 808 1399',
}

// Al cambiar el texto, INCREMENTA la versión. Nunca edites en silencio.
export const VERSION_CONSENTIMIENTOS = '2026-07-v1'

export const AVISO_PRIVACIDAD = `AVISO DE PRIVACIDAD Y POLÍTICA DE TRATAMIENTO DE DATOS PERSONALES
${EMPRESA.razon_social} — NIT ${EMPRESA.nit}
Dirección: ${EMPRESA.direccion}

En cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013, ${EMPRESA.razon_social} (en adelante, "la Empresa"), como RESPONSABLE del tratamiento, informa que los datos personales que usted suministre en este formulario de registro serán tratados con las siguientes FINALIDADES:

1. Adelantar los procesos de selección, verificación de referencias y de antecedentes, y evaluación de su hoja de vida.
2. Contactarlo(a) para las etapas del proceso y, de resultar seleccionado(a), para su vinculación laboral.
3. Cumplir obligaciones legales derivadas de una eventual relación laboral (afiliación a seguridad social, nómina, etc.).
4. Conservar su hoja de vida en el banco de talento para futuras oportunidades.

DERECHOS DEL TITULAR (Art. 8, Ley 1581/2012): conocer, actualizar y rectificar sus datos; solicitar prueba de la autorización; ser informado sobre el uso dado a sus datos; revocar la autorización y/o solicitar la supresión cuando no exista deber legal de conservarlos; presentar quejas ante la Superintendencia de Industria y Comercio (SIC).

CANAL DE RECLAMOS: puede ejercer sus derechos escribiendo a ${EMPRESA.email_pqrs} o en la dirección ${EMPRESA.direccion}.

TÉRMINO DE CONSERVACIÓN: sus datos se conservarán mientras se mantenga la finalidad del proceso y, en el banco de talento, hasta por veinticuatro (24) meses sin actividad, tras lo cual serán suprimidos, salvo obligación legal de conservación.

TRANSFERENCIAS / TRANSMISIONES: para la lectura asistida (OCR) de sus documentos, algunas imágenes pueden ser procesadas por un proveedor tecnológico que puede estar ubicado fuera de Colombia, bajo condiciones de seguridad y confidencialidad. Usted puede optar por no usar esta función y digitar sus datos manualmente.`

export const CONSENTIMIENTO_DATOS = `AUTORIZACIÓN DE TRATAMIENTO DE DATOS PERSONALES

Declaro que he leído y entendido el Aviso de Privacidad de ${EMPRESA.razon_social} (NIT ${EMPRESA.nit}) y, de manera libre, previa, expresa e informada, AUTORIZO el tratamiento de mis datos personales para las finalidades allí descritas, incluida la verificación de mis referencias y la consulta de antecedentes en listas y bases de datos públicas.

Entiendo que puedo conocer, actualizar, rectificar y suprimir mis datos, así como revocar esta autorización, escribiendo a ${EMPRESA.email_pqrs}.`

export const CONSENTIMIENTO_BIOMETRICO = `AUTORIZACIÓN PARA EL TRATAMIENTO DE DATOS BIOMÉTRICOS (DATO SENSIBLE)

Los datos biométricos (rasgos de su rostro) son DATOS SENSIBLES conforme al Art. 5 de la Ley 1581 de 2012. USTED NO ESTÁ OBLIGADO(A) A AUTORIZAR el tratamiento de datos sensibles, y puede continuar y completar todo el registro identificándose con su documento de identidad.

Si lo autoriza, ${EMPRESA.razon_social} usará una representación matemática (vector) de su rostro con la ÚNICA finalidad de identificarlo(a) y evitar registros duplicados. NO se usará para control de asistencia, vigilancia, ni se compartirá con clientes. Se almacena el vector, no la fotografía cruda. La autorización es REVOCABLE en cualquier momento, y puede solicitar la eliminación de sus datos biométricos, tras lo cual seguirá siendo atendido(a) mediante su documento.

Retención: el vector se suprime automáticamente a los 24 meses sin actividad.

AUTORIZO de forma libre, expresa e informada el tratamiento de mis datos biométricos para la finalidad de identificación y desduplicación aquí descrita.`

/** SHA-256 en hex del texto (evidencia de qué versión firmó el titular). */
export async function hashTexto(texto: string): Promise<string> {
  const data = new TextEncoder().encode(texto)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Presentación de los documentos generados: limpieza del HTML, marcadores
// visuales (firma, huella, foto) y la hoja imprimible con su estilo.
//
// Las plantillas las edita RRHH desde la plataforma. Aunque son usuarios
// internos, el HTML se limpia antes de guardarlo y antes de mostrarlo: sin
// scripts, sin iframes, sin manejadores `on*` y sin enlaces `javascript:`.

import { escapar } from './plantilla'

const ETIQUETAS_PROHIBIDAS = /<\s*\/?\s*(script|iframe|object|embed|frame|frameset|applet|base|meta|link)\b[^>]*>/gi

export function limpiarHtml(html: string): string {
  return html
    // bloques completos de script/style de terceros
    .replace(/<\s*script\b[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*iframe\b[^>]*>[\s\S]*?<\s*\/\s*iframe\s*>/gi, '')
    .replace(ETIQUETAS_PROHIBIDAS, '')
    // manejadores de eventos: onclick="…", onload='…', onerror=…
    .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    // URLs peligrosas en href/src
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|vbscript):[^"']*\2/gi, '$1="#"')
    .replace(/(href|src)\s*=\s*("|')\s*data:(?!image\/(png|jpe?g|gif|webp);)[^"']*\2/gi, '$1="#"')
}

export interface OpcionesMarcadores {
  fotoUrl?: string | null
  /** Firma del empleador configurada (data URL) — opcional. */
  firmaEmpleador?: string | null
}

const lineaFirma = (etiqueta = '') =>
  `<span class="linea-firma">${etiqueta ? `<span class="linea-firma-txt">${escapar(etiqueta)}</span>` : ''}</span>`

const imgFoto = (src: string) => `<img class="foto-carnet" alt="Foto" src="${escapar(src)}" />`

/**
 * Pone la foto de perfil en los marcadores {{FOTO_CARNET}}. Al generar se usa
 * con la imagen incrustada (data URL): así sale al imprimir sin depender de un
 * enlace que vence y queda dentro de lo que se firma.
 */
export function incrustarFoto(html: string, src: string | null | undefined): string {
  return src ? html.replaceAll('{{FOTO_CARNET}}', imgFoto(src)) : html
}

/**
 * Resuelve los marcadores reservados que quedan después de generar:
 * - lo que no se ha firmado queda como línea para firmar en papel;
 * - huellas como recuadro;
 * - foto carnet como imagen (si hay URL) o recuadro.
 */
export function resolverMarcadores(html: string, op: OpcionesMarcadores = {}): string {
  const foto = op.fotoUrl ? imgFoto(op.fotoUrl) : '<span class="foto-carnet foto-vacia">FOTO</span>'
  const firmaEmp = op.firmaEmpleador
    ? `<img class="firma-img" alt="Firma del empleador" src="${escapar(op.firmaEmpleador)}" />`
    : lineaFirma()
  return html
    .replaceAll('{{FOTO_CARNET}}', foto)
    .replaceAll('{{HUELLA}}', '<span class="huella">Huella índice derecho</span>')
    .replaceAll('{{HUELLA_IZQUIERDA}}', '<span class="huella">Huella índice izquierdo</span>')
    .replaceAll('{{FIRMA_TRABAJADOR}}', lineaFirma())
    .replaceAll('{{FECHA_FIRMA}}', '')
    .replaceAll('{{FIRMA_EMPLEADOR}}', firmaEmp)
    .replaceAll('{{FIRMA_TESTIGO1}}', lineaFirma())
    .replaceAll('{{FIRMA_TESTIGO2}}', lineaFirma())
    .replaceAll('{{FIRMA_RESPONSABLE}}', lineaFirma())
    .replaceAll('{{FIRMA_EVALUADOR}}', lineaFirma())
}

/** Estilo común de todos los formatos (carta, Arial, tablas con borde). */
export const CSS_DOCUMENTO = `
@page { size: letter; margin: 14mm 14mm 16mm; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 10.5pt; line-height: 1.38; color: #111; }
.documento { padding: 18px 22px; }
.hoja { page-break-after: always; break-after: page; }
.hoja:last-child { page-break-after: auto; break-after: auto; }
p { margin: 0 0 8px; text-align: justify; }
h1, h2, h3 { margin: 10px 0 6px; }
h2 { font-size: 11pt; text-transform: uppercase; }
h3 { font-size: 10.5pt; }
ul, ol { margin: 4px 0 8px 20px; padding: 0; }
li { margin: 1px 0; }
table { border-collapse: collapse; width: 100%; margin: 0 0 8px; }
td, th { border: 1px solid #333; padding: 3px 5px; vertical-align: top; font-size: 9.5pt; }
th { background: #eef3f1; text-align: left; font-weight: bold; }
.sin-borde td, .sin-borde th, td.sin-borde, th.sin-borde { border: none; }
.etiqueta { background: #f4f6f5; font-weight: bold; font-size: 8.5pt; text-transform: uppercase; width: 1%; white-space: nowrap; }
.valor { font-weight: normal; }
.centro { text-align: center; }
.derecha { text-align: right; }
.mayus { text-transform: uppercase; }
.negrita { font-weight: bold; }
.pequeno { font-size: 8.5pt; }
.muy-pequeno { font-size: 7.5pt; }
.nota { font-size: 8.5pt; color: #333; }
.caja { border: 1px solid #333; padding: 8px 10px; margin: 6px 0 10px; }
.caja-gris { background: #f4f4f4; border: 1px solid #999; padding: 8px 10px; margin: 6px 0 10px; }
.marca { display: inline-block; min-width: 14px; text-align: center; font-weight: bold; }
.casilla { display: inline-block; width: 14px; height: 14px; border: 1px solid #333; text-align: center; line-height: 12px; font-size: 9pt; font-weight: bold; vertical-align: middle; }
.encabezado { margin-bottom: 12px; }
.encabezado td { vertical-align: middle; }
.encabezado .logo { width: 150px; text-align: center; border-right: 1px solid #333; }
.encabezado .logo img { max-width: 135px; max-height: 50px; }
.encabezado .titulo { text-align: center; font-weight: bold; font-size: 11.5pt; text-transform: uppercase; }
.encabezado .version { width: 130px; font-size: 8.5pt; font-weight: bold; }
.firmas { width: 100%; margin-top: 22px; }
.firmas td { border: none; padding: 4px 10px 4px 0; vertical-align: bottom; width: 50%; }
.linea-firma { display: inline-block; min-width: 230px; border-bottom: 1px solid #111; height: 34px; vertical-align: bottom; position: relative; }
.linea-firma-txt { position: absolute; bottom: -14px; left: 0; font-size: 7.5pt; color: #555; }
.firma-img { max-height: 56px; max-width: 240px; display: inline-block; vertical-align: bottom; border-bottom: 1px solid #111; }
.huella { display: inline-flex; align-items: flex-end; justify-content: center; width: 92px; height: 112px; border: 1px solid #333; font-size: 7pt; text-align: center; padding: 3px; color: #555; vertical-align: bottom; }
.foto-carnet { width: 96px; height: 120px; object-fit: cover; border: 1px solid #333; display: inline-block; }
.foto-vacia { display: inline-flex; align-items: center; justify-content: center; font-size: 8pt; color: #777; }
.pie { margin-top: 14px; font-size: 8pt; text-align: center; color: #444; }
.solo-interno { border: 1px dashed #999; padding: 8px; margin-top: 10px; }
.sello-digital { margin-top: 16px; padding: 6px 8px; border: 1px solid #b7d7cc; background: #f1f8f5; font-size: 7.5pt; color: #1f4f45; }
/* Formatos de hoja fija (p. ej. "Página 1 de 2"): más apretados para que cada hoja quepa en una carta. */
.compacta { font-size: 9.5pt; line-height: 1.25; }
.compacta p { margin-bottom: 5px; }
.compacta h2 { margin: 6px 0 4px; }
.compacta table { margin-bottom: 5px; }
.compacta td, .compacta th { padding: 2px 4px; font-size: 8.5pt; }
.compacta .encabezado { margin-bottom: 6px; }
.compacta .huella { height: 92px; }
.compacta .pie { margin-top: 6px; }
@media print { .documento { padding: 0; } .no-imprimir { display: none !important; } }
/* Lectura en el celular: el formato se acomoda al ancho de la pantalla. No
   aplica al imprimir ni al armar el paquete PDF (se arma a ~710 px). */
@media screen and (max-width: 560px) {
  .documento { padding: 12px; }
  p { text-align: left; }
  td, th { overflow-wrap: anywhere; }
  .etiqueta { white-space: normal; }
  .encabezado .logo { width: 84px; }
  .encabezado .logo img { max-width: 76px; }
  .encabezado .version { width: 84px; font-size: 7.5pt; }
  .encabezado .titulo { font-size: 10pt; }
  .firmas td { display: block; width: 100%; padding-right: 0; }
  .linea-firma { min-width: 0; width: 100%; max-width: 260px; }
  .firma-img { max-width: 100%; }
}
`

/** Documento HTML completo (para el visor y para imprimir / guardar como PDF). */
export function documentoCompleto(cuerpo: string, titulo = 'Documento'): string {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>${escapar(titulo)}</title>
<style>${CSS_DOCUMENTO}</style></head><body><div class="documento">${cuerpo}</div></body></html>`
}

/** Sello con la evidencia de firma electrónica (se agrega al imprimir un documento firmado). */
export function selloFirma(evidencia: Record<string, unknown> | null | undefined, sha256?: string | null): string {
  if (!evidencia) return ''
  const partes = [
    evidencia.firmado_local ? `Firmado electrónicamente el ${escapar(String(evidencia.firmado_local))}` : 'Firmado electrónicamente',
    evidencia.documento ? `por el titular del documento ${escapar(String(evidencia.documento))}` : '',
    evidencia.ip ? `desde la IP ${escapar(String(evidencia.ip))}` : '',
  ].filter(Boolean)
  return `<div class="sello-digital">${partes.join(' ')}.${sha256 ? ` Huella SHA-256: ${escapar(sha256)}` : ''}</div>`
}

/** HTML listo para mostrar: limpio y con los marcadores resueltos. */
export function htmlParaMostrar(
  doc: { html_render: string; html_firmado?: string | null; firma_evidencia?: Record<string, unknown> | null; sha256?: string | null },
  op: OpcionesMarcadores = {},
): string {
  const base = doc.html_firmado || doc.html_render
  const cuerpo = resolverMarcadores(limpiarHtml(base), op) + (doc.html_firmado ? selloFirma(doc.firma_evidencia, doc.sha256) : '')
  return cuerpo
}

/** Abre una ventana con el documento y lanza la impresión (guardar como PDF). */
export function imprimirHtml(cuerpo: string, titulo: string): void {
  const w = window.open('', '_blank')
  if (!w) return
  w.document.open()
  w.document.write(documentoCompleto(cuerpo, titulo))
  w.document.close()
  w.focus()
  // Imprime cuando cargaron las imágenes (logo, foto, firmas) para que salgan en
  // el papel; si alguna no responde, imprime igual a los pocos segundos.
  const pendientes = Array.from(w.document.images).filter((im) => !im.complete)
  const cargadas = Promise.all(pendientes.map((im) => new Promise<void>((ok) => {
    im.addEventListener('load', () => ok(), { once: true })
    im.addEventListener('error', () => ok(), { once: true })
  })))
  const limite = new Promise<void>((ok) => setTimeout(ok, 8000))
  void Promise.race([cargadas, limite]).then(() => {
    setTimeout(() => { try { w.print() } catch { /* el usuario puede imprimir a mano */ } }, 150)
  })
}

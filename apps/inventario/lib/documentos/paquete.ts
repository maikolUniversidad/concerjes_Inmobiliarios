// Paquete de contratación en un solo PDF, en el orden que elija RRHH.
//
// Se arma en el navegador: los formatos generados (HTML) se pasan a páginas
// carta con los mismos márgenes de la impresión, cortando entre renglones; los
// documentos que subió el candidato se agregan tal cual (los PDF se copian sin
// perder calidad; las fotos van en una página, livianas). Al principio va un
// índice con la página donde empieza cada documento.

import { documentoCompleto } from './html'

export type TipoItemPaquete = 'plantilla' | 'documento' | 'prueba'
export interface ItemPaquete { tipo: TipoItemPaquete; codigo: string }

export type PiezaPaquete =
  | { clase: 'html'; titulo: string; html: string }
  | { clase: 'archivo'; titulo: string; url: string; mime: string | null; nombre: string }
  | { clase: 'aviso'; titulo: string; texto: string }

export interface OpcionesPaquete {
  /** Encabezado del índice. */
  portada: { titulo: string; lineas: string[] }
  onProgreso?: (hechas: number, total: number, titulo: string) => void
}

// Carta: 612 × 792 pt. Márgenes iguales a los de CSS_DOCUMENTO (@page 14mm 14mm 16mm).
const PAGINA = { ancho: 612, alto: 792 }
const MM = 72 / 25.4
const MARGEN = { izq: 14 * MM, der: 14 * MM, arriba: 14 * MM, abajo: 16 * MM }
const PT_POR_PX = 0.75                                  // 96 px = 72 pt
const ANCHO_PX = Math.round((PAGINA.ancho - MARGEN.izq - MARGEN.der) / PT_POR_PX)  // ≈ 710 px, como al imprimir
const ALTO_PX = Math.floor((PAGINA.alto - MARGEN.arriba - MARGEN.abajo) / PT_POR_PX) // ≈ 942 px por página
const ESCALA = 2                                        // nitidez del texto al pasar a imagen

/**
 * Dónde cortar un documento largo en páginas: se fuerza corte al empezar cada
 * `.hoja`; si una hoja no cabe, se corta en el último borde de renglón que
 * quepa (así no queda una línea partida por la mitad).
 */
export function cortesDePagina(alto: number, altoPagina: number, forzados: number[], bordes: number[]): [number, number][] {
  const obligatorios = [...new Set(forzados.filter((f) => f > 0 && f < alto))].sort((a, b) => a - b)
  const candidatos = [...new Set(bordes.filter((b) => b > 0 && b <= alto))].sort((a, b) => a - b)
  const paginas: [number, number][] = []
  let y = 0
  while (y < alto - 1) {
    const limite = y + altoPagina
    const forzado = obligatorios.find((f) => f > y)
    let corte: number
    if (forzado !== undefined && forzado <= limite) corte = forzado
    else if (limite >= alto) corte = alto
    else {
      // Último borde que quepa, sin dejar páginas casi vacías (mínimo un tercio).
      const utiles = candidatos.filter((c) => c > y + altoPagina / 3 && c <= limite)
      corte = utiles.length ? utiles[utiles.length - 1] : limite
    }
    paginas.push([y, corte])
    y = corte
  }
  return paginas
}

/**
 * Puntos de corte entre renglones de texto (fuera de tablas): la mitad del
 * espacio entre un renglón y el siguiente. Se corta en la mitad y no justo en
 * el borde porque al pasar a imagen el texto queda 1 o 2 px más abajo, y así
 * no se asoman las colas de las letras (p, g, j) en la página siguiente.
 */
export function cortesEntreRenglones(renglones: { top: number; bottom: number }[]): number[] {
  const orden = [...renglones].sort((a, b) => a.top - b.top)
  // Varios trozos de un mismo renglón (negrita + normal) cuentan como uno.
  const lineas: { top: number; bottom: number }[] = []
  for (const r of orden) {
    const ultima = lineas[lineas.length - 1]
    if (ultima && r.top < ultima.bottom - 2) ultima.bottom = Math.max(ultima.bottom, r.bottom)
    else lineas.push({ ...r })
  }
  const cortes: number[] = []
  for (let i = 0; i + 1 < lineas.length; i++) {
    if (lineas[i + 1].top >= lineas[i].bottom) cortes.push(Math.round((lineas[i].bottom + lineas[i + 1].top) / 2))
  }
  return cortes
}

function lineasDeTexto(doc: Document, raiz: HTMLElement, base: number): number[] {
  const renglones: { top: number; bottom: number }[] = []
  const recorrido = doc.createTreeWalker(raiz, NodeFilter.SHOW_TEXT)
  const rango = doc.createRange()
  for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) {
    if (!n.textContent?.trim() || n.parentElement?.closest('td, th')) continue
    rango.selectNodeContents(n)
    for (const r of Array.from(rango.getClientRects())) renglones.push({ top: r.top - base, bottom: r.bottom - base })
  }
  return cortesEntreRenglones(renglones)
}

/**
 * Ya dibujado el documento, corre cada corte (que no sea inicio de hoja) a la
 * fila en blanco más cercana: el texto dibujado no queda exactamente donde lo
 * midió el navegador, y así ninguna letra queda partida entre dos páginas.
 */
function ajustarCortesAFilasEnBlanco(lienzo: HTMLCanvasElement, cortes: [number, number][], forzados: number[]): void {
  let ctx: CanvasRenderingContext2D | null = null
  try { ctx = lienzo.getContext('2d', { willReadFrequently: true }) } catch { return }
  if (!ctx) return
  const fijos = new Set(forzados)
  const enBlanco = (y: number): boolean => {
    if (y <= 0 || y >= lienzo.height) return false
    const d = ctx!.getImageData(0, y, lienzo.width, 1).data
    for (let i = 0; i < d.length; i += 4) if (d[i] < 235 || d[i + 1] < 235 || d[i + 2] < 235) return false
    return true
  }
  const margen = 14 * ESCALA   // hasta 14 px hacia arriba (o 7 hacia abajo) para encontrar el hueco
  try {
    for (let i = 0; i + 1 < cortes.length; i++) {
      const y = cortes[i][1]
      if (fijos.has(y)) continue
      const yc = Math.round(y * ESCALA)
      let nuevo: number | null = null
      for (let k = 0; k <= margen && nuevo === null; k++) if (enBlanco(yc - k)) nuevo = yc - k
      for (let k = 1; k <= margen / 2 && nuevo === null; k++) if (enBlanco(yc + k)) nuevo = yc + k
      if (nuevo !== null && nuevo / ESCALA > cortes[i][0] + 10) {
        cortes[i][1] = nuevo / ESCALA
        cortes[i + 1][0] = nuevo / ESCALA
      }
    }
  } catch { /* lienzo con imágenes de otro origen: se deja el corte medido */ }
}

async function esperarImagenes(doc: Document): Promise<void> {
  const pendientes = Array.from(doc.images).filter((im) => !im.complete)
  await Promise.race([
    Promise.all(pendientes.map((im) => new Promise<void>((ok) => {
      im.addEventListener('load', () => ok(), { once: true })
      im.addEventListener('error', () => ok(), { once: true })
    }))),
    new Promise<void>((ok) => setTimeout(ok, 10000)),
  ])
  try { await (doc as Document & { fonts?: FontFaceSet }).fonts?.ready } catch { /* sin API de fuentes */ }
}

/** Pasa un documento HTML a imágenes JPEG, una por página. */
async function htmlAPaginas(html: string, titulo: string): Promise<{ jpg: Uint8Array; altoPx: number }[]> {
  const html2canvas = (await import('html2canvas')).default
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = `position:fixed;left:-20000px;top:0;width:${ANCHO_PX}px;height:${ALTO_PX}px;border:0;visibility:hidden`
  // Sin relleno: el ancho del marco ya es el ancho útil de la página.
  iframe.srcdoc = documentoCompleto(html, titulo)
    .replace('</style>', '.documento{padding:0!important}html,body{background:#fff}</style>')
  document.body.appendChild(iframe)
  try {
    await new Promise<void>((ok) => { iframe.onload = () => ok() })
    const doc = iframe.contentDocument!
    await esperarImagenes(doc)
    const raiz = doc.querySelector('.documento') as HTMLElement
    const base = raiz.getBoundingClientRect().top
    const alto = Math.ceil(raiz.scrollHeight)
    const forzados = Array.from(doc.querySelectorAll('.hoja')).map((h) => Math.round(h.getBoundingClientRect().top - base))
    // Tablas: se corta entre filas.
    const bordes = Array.from(doc.querySelectorAll('tr, table, .caja, .caja-gris, .firmas, .sello-digital, .hoja'))
      .map((el) => Math.round(el.getBoundingClientRect().bottom - base))
    bordes.push(...lineasDeTexto(doc, raiz, base))
    const cortes = cortesDePagina(alto, ALTO_PX, forzados, bordes)

    const lienzo = await html2canvas(raiz, {
      scale: ESCALA, backgroundColor: '#ffffff', useCORS: true, logging: false,
      width: ANCHO_PX, height: alto, windowWidth: ANCHO_PX, windowHeight: alto,
    })
    ajustarCortesAFilasEnBlanco(lienzo, cortes, forzados)
    const paginas: { jpg: Uint8Array; altoPx: number }[] = []
    for (const [y0, y1] of cortes) {
      const c = document.createElement('canvas')
      c.width = ANCHO_PX * ESCALA
      c.height = Math.max(1, Math.round((y1 - y0) * ESCALA))
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(lienzo, 0, Math.round(y0 * ESCALA), c.width, c.height, 0, 0, c.width, c.height)
      paginas.push({ jpg: await canvasAJpg(c, 0.88), altoPx: y1 - y0 })
    }
    return paginas
  } finally {
    iframe.remove()
  }
}

function canvasAJpg(c: HTMLCanvasElement, calidad: number): Promise<Uint8Array> {
  return new Promise((ok, mal) => c.toBlob(async (b) => {
    if (!b) { mal(new Error('No se pudo convertir la página.')); return }
    ok(new Uint8Array(await b.arrayBuffer()))
  }, 'image/jpeg', calidad))
}

/** Foto del celular → JPEG liviano (máx. 1800 px del lado largo). */
async function imagenLiviana(blob: Blob): Promise<{ jpg: Uint8Array; ancho: number; alto: number }> {
  const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const escala = Math.min(1, 1800 / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * escala)
  c.height = Math.round(bmp.height * escala)
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return { jpg: await canvasAJpg(c, 0.85), ancho: c.width, alto: c.height }
}

/** Texto seguro para las fuentes estándar del PDF (WinAnsi): sin caracteres que no existan ahí. */
function textoPdf(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/→/g, '->')
    .replace(/[^\x20-\x7E -ÿ]/g, '')
}

/** Arma el PDF del paquete con las piezas en el orden dado. */
export async function armarPaquetePdf(piezas: PiezaPaquete[], op: OpcionesPaquete): Promise<Blob> {
  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  const normal = await pdf.embedFont(StandardFonts.Helvetica)
  const negrita = await pdf.embedFont(StandardFonts.HelveticaBold)
  const indice: { titulo: string; pagina: number; nota?: string }[] = []

  const paginaAviso = (titulo: string, texto: string) => {
    const p = pdf.addPage([PAGINA.ancho, PAGINA.alto])
    p.drawText(textoPdf(titulo), { x: MARGEN.izq, y: PAGINA.alto - 90, size: 14, font: negrita, color: rgb(0.1, 0.1, 0.1) })
    p.drawText(textoPdf(texto), { x: MARGEN.izq, y: PAGINA.alto - 115, size: 10, font: normal, color: rgb(0.3, 0.3, 0.3), maxWidth: PAGINA.ancho - MARGEN.izq - MARGEN.der, lineHeight: 14 })
  }

  for (let i = 0; i < piezas.length; i++) {
    const pz = piezas[i]
    op.onProgreso?.(i, piezas.length, pz.titulo)
    const inicio = pdf.getPageCount() + 1
    try {
      if (pz.clase === 'html') {
        for (const pg of await htmlAPaginas(pz.html, pz.titulo)) {
          const img = await pdf.embedJpg(pg.jpg)
          const alto = pg.altoPx * PT_POR_PX
          const p = pdf.addPage([PAGINA.ancho, PAGINA.alto])
          p.drawImage(img, { x: MARGEN.izq, y: PAGINA.alto - MARGEN.arriba - alto, width: ANCHO_PX * PT_POR_PX, height: alto })
        }
        indice.push({ titulo: pz.titulo, pagina: inicio })
      } else if (pz.clase === 'archivo') {
        const res = await fetch(pz.url)
        if (!res.ok) throw new Error(`No se pudo descargar (HTTP ${res.status}).`)
        const blob = await res.blob()
        const mime = (pz.mime || blob.type || '').toLowerCase()
        const ext = pz.nombre.split('.').pop()?.toLowerCase() ?? ''
        if (mime === 'application/pdf' || ext === 'pdf') {
          const origen = await PDFDocument.load(await blob.arrayBuffer(), { ignoreEncryption: true })
          const copiadas = await pdf.copyPages(origen, origen.getPageIndices())
          copiadas.forEach((pg) => pdf.addPage(pg))
        } else if (/^image\/(jpe?g|png|webp|gif|bmp)$/.test(mime) || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext)) {
          const im = await imagenLiviana(blob)
          const img = await pdf.embedJpg(im.jpg)
          const maxAncho = PAGINA.ancho - MARGEN.izq - MARGEN.der
          const maxAlto = PAGINA.alto - MARGEN.arriba - MARGEN.abajo - 20
          const f = Math.min(maxAncho / im.ancho, maxAlto / im.alto)
          const w = im.ancho * f, h = im.alto * f
          const p = pdf.addPage([PAGINA.ancho, PAGINA.alto])
          p.drawText(textoPdf(pz.titulo), { x: MARGEN.izq, y: PAGINA.alto - MARGEN.arriba + 4, size: 8, font: normal, color: rgb(0.45, 0.45, 0.45) })
          p.drawImage(img, { x: (PAGINA.ancho - w) / 2, y: PAGINA.alto - MARGEN.arriba - 12 - h, width: w, height: h })
        } else {
          paginaAviso(pz.titulo, `El archivo "${pz.nombre}" (${ext.toUpperCase() || 'formato desconocido'}) no se puede incluir en el PDF. Descárguelo aparte desde el expediente.`)
        }
        // Varios archivos del mismo documento (p. ej. cédula por las dos caras) van seguidos con una sola entrada.
        if (indice[indice.length - 1]?.titulo !== pz.titulo) indice.push({ titulo: pz.titulo, pagina: inicio })
      } else {
        paginaAviso(pz.titulo, pz.texto)
        indice.push({ titulo: pz.titulo, pagina: inicio, nota: 'aviso' })
      }
    } catch (e) {
      paginaAviso(pz.titulo, `No se pudo incluir: ${e instanceof Error ? e.message : 'error'}. Revíselo en el expediente.`)
      indice.push({ titulo: pz.titulo, pagina: inicio, nota: 'con error' })
    }
  }
  op.onProgreso?.(piezas.length, piezas.length, 'Índice')

  // Índice al principio (las páginas se corren una o más por el índice mismo).
  const porPagina = 38
  const paginasIndice = Math.max(1, Math.ceil(indice.length / porPagina))
  for (let k = 0; k < paginasIndice; k++) {
    const p = pdf.insertPage(k, [PAGINA.ancho, PAGINA.alto])
    let y = PAGINA.alto - 60
    if (k === 0) {
      p.drawText(textoPdf(op.portada.titulo), { x: MARGEN.izq, y, size: 16, font: negrita, color: rgb(0.18, 0.49, 0.2) })
      y -= 20
      for (const l of op.portada.lineas) { p.drawText(textoPdf(l), { x: MARGEN.izq, y, size: 10, font: normal, color: rgb(0.25, 0.25, 0.25) }); y -= 14 }
      y -= 10
      p.drawText('Contenido', { x: MARGEN.izq, y, size: 12, font: negrita }); y -= 18
    }
    for (const it of indice.slice(k * porPagina, (k + 1) * porPagina)) {
      const pagina = String(it.pagina + paginasIndice)
      p.drawText(textoPdf(it.titulo + (it.nota ? ` (${it.nota})` : '')), { x: MARGEN.izq, y, size: 10, font: normal, maxWidth: 440 })
      p.drawText(pagina, { x: PAGINA.ancho - MARGEN.der - normal.widthOfTextAtSize(pagina, 10), y, size: 10, font: normal })
      y -= 16
    }
  }

  pdf.setTitle(textoPdf(op.portada.titulo))
  pdf.setCreator('Conserjes Inmobiliarios · plataforma')
  const bytes = await pdf.save()
  return new Blob([bytes as BlobPart], { type: 'application/pdf' })
}

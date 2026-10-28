// Armado del PDF de placas de QR (F2). Corre en el NAVEGADOR.
//
// Se reutiliza lo que el repositorio ya trae y usa el carné para su PDF
// (`jspdf` en milímetros + `qrcode` a data URL): no entra ninguna librería
// nueva por esto.
//
// La medida que manda es el lado del QR: 50 mm como mínimo en todos los
// formatos, que es con lo que el ADR-B lo da por legible. Todo lo demás —
// márgenes, tamaño de letra, posición del código manual— se acomoda alrededor
// de ese cuadrado, nunca al contrario.

// Solo el TIPO de jspdf se importa estáticamente (TypeScript lo borra al
// compilar). La librería —~1,4 MB, 400 KB comprimido— entra por `import()`
// dentro de `armarPdfDeLote`, que es lo único que la necesita y corre cuando
// alguien pide el lote de placas, no al abrir la pantalla.
import type { jsPDF } from 'jspdf'
import QRCode from 'qrcode'
import { FORMATOS, formatearManual, urlDelQr, type FormatoLote } from '@/lib/puntos-qr'

const VERDE = '#1B5E20'

export interface PlacaDatos {
  qrId: string
  token: string
  codigoManual: string
  puntoCodigo: string
  puntoNombre: string
  sedeNombre: string
  zonaPiso: string | null
  contratoNombre: string
  arteColor: string | null
}

/** Convierte un color `#rrggbb` a los tres componentes que quiere jsPDF. Si el
 *  contrato trae un color inservible se cae al verde de la marca en vez de
 *  pintar una placa negra. */
function rgb(color: string | null): [number, number, number] {
  const c = (color ?? '').trim()
  const hex = /^#?([0-9a-fA-F]{6})$/.exec(c)?.[1] ?? VERDE.slice(1)
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ]
}

/** El logo de la empresa, como data URL, para embeberlo en el PDF. Devuelve
 *  null si no se pudo cargar: una placa sin logo sirve, una impresión que falla
 *  no. */
async function cargarLogo(): Promise<string | null> {
  try {
    const r = await fetch('/logo-horizontal.png')
    if (!r.ok) return null
    const blob = await r.blob()
    return await new Promise((resolve) => {
      const fr = new FileReader()
      fr.onload = () => resolve(String(fr.result))
      fr.onerror = () => resolve(null)
      fr.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}

/** QR de un token, como data URL en resolución de imprenta.
 *
 *  `errorCorrectionLevel: 'Q'` (25 % de redundancia) no es por capricho: la
 *  placa va a una pared y va a acumular polvo, raspones y un pedazo de cinta.
 *  Con un token de 21 caracteres el QR sigue siendo de módulo grande, así que
 *  la redundancia no cuesta legibilidad. */
async function qrDataUrl(token: string, base: string): Promise<string> {
  return QRCode.toDataURL(urlDelQr(token, base), {
    // 1.000 píxeles de lado: ~508 ppp sobre un QR de 50 mm y ~282 ppp sobre uno
    // de 90 mm, por encima de lo que imprime cualquier equipo de oficina. Subir
    // de aquí solo engorda el PDF; bajar de ~400 empieza a redondear los
    // módulos y es justo lo que hace que una cámara dude.
    width: 1000,
    margin: 1,
    errorCorrectionLevel: 'Q',
    color: { dark: '#000000', light: '#ffffff' },
  })
}

/** Dibuja una placa dentro del rectángulo dado. */
function dibujarPlaca(
  pdf: jsPDF,
  x: number, y: number, w: number, h: number,
  d: PlacaDatos, qr: string, ladoQr: number, logo: string | null,
) {
  const [r, g, b] = rgb(d.arteColor)
  const margen = Math.min(4, w * 0.05)

  // Marco del color del contrato.
  pdf.setDrawColor(r, g, b)
  pdf.setLineWidth(0.8)
  pdf.roundedRect(x + margen / 2, y + margen / 2, w - margen, h - margen, 3, 3, 'S')

  // Franja superior con el nombre del contrato.
  const banda = w >= 100 ? 9 : 7
  pdf.setFillColor(r, g, b)
  pdf.roundedRect(x + margen / 2, y + margen / 2, w - margen, banda, 3, 3, 'F')
  pdf.rect(x + margen / 2, y + margen / 2 + banda - 4, w - margen, 4, 'F')
  pdf.setTextColor(255, 255, 255)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(w >= 100 ? 8 : 7)
  pdf.text(
    pdf.splitTextToSize(d.contratoNombre || 'Conserjes Inmobiliarios', w - margen - 6)[0] ?? '',
    x + w / 2, y + margen / 2 + banda - 2.2, { align: 'center' },
  )

  // El QR, centrado y con su lado exacto. Es lo único que NO se negocia: si
  // algo no cabe, se cae lo demás, nunca el cuadrado de 50 mm.
  const qrX = x + (w - ladoQr) / 2
  const qrY = y + margen / 2 + banda + 2
  pdf.addImage(qr, 'PNG', qrX, qrY, ladoQr, ladoQr)

  // ── Reparto de lo que queda ────────────────────────────────────────────────
  // Un sticker de 8×8 cm con un QR de 5 cm deja apenas 1,5 cm útiles: ahí no
  // caben el nombre, la sede, el pie y el logo, y meterlos a la fuerza los
  // imprime fuera del adhesivo. Así que lo de abajo se arma desde el borde
  // inferior hacia arriba y cada elemento entra SOLO si queda sitio, en este
  // orden de importancia: el código manual siempre, después el pie, después el
  // logo. Lo de arriba (nombre y lugar) usa lo que sobre en medio.
  const fondo = y + h - margen / 2
  const altoCaja = 8.5
  const anchoLogo = Math.min(26, w * 0.3)
  const altoLogo = anchoLogo / 3.55
  let cursor = qrY + ladoQr + (w >= 100 ? 4.5 : 3)

  let pie = fondo
  let logoY: number | null = null
  let pieY: number | null = null
  if (logo && pie - cursor > altoCaja + 3 + altoLogo + 2) {
    pie -= altoLogo
    logoY = pie
    pie -= 1.5
  }
  if (pie - cursor > altoCaja + 3 + 2) {
    pie -= 2.2
    pieY = pie
    pie -= 1
  }
  const cajaY = pie - altoCaja

  // Nombre del punto, hasta dos líneas y solo las que quepan.
  pdf.setTextColor(17, 24, 39)
  pdf.setFont('helvetica', 'bold')
  const tamNombre = w >= 100 ? 12 : 10
  const pasoNombre = w >= 100 ? 5 : 4.2
  pdf.setFontSize(tamNombre)
  const disponible = cajaY - 1.5 - cursor
  const cabenNombre = Math.max(1, Math.min(2, Math.floor(disponible / pasoNombre)))
  for (const linea of pdf.splitTextToSize(d.puntoNombre, w - margen - 6).slice(0, cabenNombre)) {
    pdf.text(linea, x + w / 2, cursor, { align: 'center' })
    cursor += pasoNombre
  }

  // Sede, zona y piso: lo primero que se cae cuando la placa es pequeña.
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(w >= 100 ? 8.5 : 7.5)
  pdf.setTextColor(107, 114, 128)
  const lugar = [d.sedeNombre, d.zonaPiso].filter(Boolean).join(' · ')
  const cabenLugar = Math.min(2, Math.floor((cajaY - 1.5 - cursor) / 3.6))
  if (cabenLugar > 0) {
    for (const linea of pdf.splitTextToSize(lugar, w - margen - 6).slice(0, cabenLugar)) {
      pdf.text(linea, x + w / 2, cursor, { align: 'center' })
      cursor += 3.6
    }
  }

  // El código manual: lo que se teclea cuando la cámara no lee. En caja, en
  // monoespaciada y en grande, porque es el plan B de toda la placa.
  const cajaW = Math.min(w - margen - 8, 52)
  pdf.setDrawColor(209, 213, 219)
  pdf.setLineWidth(0.3)
  pdf.roundedRect(x + (w - cajaW) / 2, cajaY, cajaW, altoCaja, 1.5, 1.5, 'S')
  pdf.setFont('courier', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(r, g, b)
  pdf.text(formatearManual(d.codigoManual), x + w / 2, cajaY + 6, { align: 'center' })

  if (pieY !== null) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(6)
    pdf.setTextColor(156, 163, 175)
    pdf.text(`Punto ${d.puntoCodigo} · si la cámara no lee, escribe el código`,
      x + w / 2, pieY, { align: 'center' })
  }
  if (logo && logoY !== null) {
    // El logo al pie, manteniendo su proporción (la imagen de /public es 3,55:1).
    pdf.addImage(logo, 'PNG', x + (w - anchoLogo) / 2, logoY, anchoLogo, altoLogo)
  }
}

/** Marcas de corte de una celda de la hoja A4. */
function marcasDeCorte(pdf: jsPDF, x: number, y: number, w: number, h: number) {
  pdf.setDrawColor(209, 213, 219)
  pdf.setLineWidth(0.2)
  const t = 3
  for (const [cx, cy, dx, dy] of [
    [x, y, t, 0], [x, y, 0, t],
    [x + w, y, -t, 0], [x + w, y, 0, t],
    [x, y + h, t, 0], [x, y + h, 0, -t],
    [x + w, y + h, -t, 0], [x + w, y + h, 0, -t],
  ]) {
    pdf.line(cx, cy, cx + dx, cy + dy)
  }
}

/**
 * Arma el PDF del lote. Devuelve el documento de jsPDF para que la pantalla
 * decida qué hacer con él (vista previa en un iframe, o abrir el diálogo de
 * impresión). **Armar el PDF NO cuenta como imprimir**: la impresión se registra
 * aparte, al confirmar, con `registrarLote`.
 */
export async function armarPdfDeLote(
  placas: PlacaDatos[], formato: FormatoLote, base: string,
  // `comprimir: false` deja el contenido del PDF en claro. Lo usa
  // `scripts/probar-placas-qr-f2.mjs` para poder comprobar que el código manual
  // quedó impreso de verdad; en la pantalla siempre va comprimido.
  { comprimir = true }: { comprimir?: boolean } = {},
): Promise<jsPDF> {
  if (placas.length === 0) throw new Error('No hay placas que imprimir.')

  const f = FORMATOS[formato]
  const logo = await cargarLogo()
  // Los QR se generan todos antes de dibujar: así un fallo deja el PDF sin
  // empezar en vez de a medias.
  const qrs = await Promise.all(placas.map((p) => qrDataUrl(p.token, base)))

  const { jsPDF: JsPDF } = await import('jspdf')
  const pdf = new JsPDF({
    orientation: f.ancho > f.alto ? 'landscape' : 'portrait',
    unit: 'mm',
    format: [f.ancho, f.alto],
    compress: comprimir,
  })

  const porHoja = f.columnas * f.filas
  const celdaW = f.ancho / f.columnas
  const celdaH = f.alto / f.filas

  placas.forEach((placa, i) => {
    if (i > 0 && i % porHoja === 0) pdf.addPage([f.ancho, f.alto])
    const enHoja = i % porHoja
    const col = enHoja % f.columnas
    const fila = Math.floor(enHoja / f.columnas)
    const x = col * celdaW
    const y = fila * celdaH
    if (porHoja > 1) marcasDeCorte(pdf, x, y, celdaW, celdaH)
    dibujarPlaca(pdf, x, y, celdaW, celdaH, placa, qrs[i], f.qr, logo)
  })

  return pdf
}

// Pruebas del PDF de placas de QR (F2 del módulo de Puntos QR).
//
// No toca la base de datos: lo que se prueba aquí es el papel que va a salir de
// la impresora, que es lo único de este módulo que no se puede corregir después
// sin volver a la pared.
//
// Qué comprueba, sobre el MISMO código que usa la pantalla
// (`app/(dashboard)/rondas/qr/placas.ts`):
//   1. que el QR salga a 50 mm o más en los cuatro formatos (ADR-B);
//   2. que a esa medida cada módulo del QR quede por encima de 0,4 mm, que es
//      el mínimo con el que una impresora de oficina y la cámara de un celular
//      de gama baja se entienden. Es el criterio de "legible", no una opinión;
//   3. que el código manual quede IMPRESO en la placa, con sus ocho caracteres
//      y agrupado — es el plan B de todo el módulo cuando la cámara falla;
//   4. que el número de páginas sea el que toca (la hoja A4 lleva 6 placas) y
//      que cada página tenga el tamaño del formato.
//
// Deja un PDF de muestra para mirar, por defecto en el directorio temporal.
//
// Uso (desde la raíz del worktree):
//   node scripts/probar-placas-qr-f2.mjs [carpeta-de-salida]
import { createRequire } from 'module'
import { registerHooks } from 'node:module'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { fileURLToPath, pathToFileURL } from 'url'
import { dirname, join, resolve } from 'path'
import { tmpdir } from 'os'

const require = createRequire(import.meta.url)
const { PDFDocument } = require('pdf-lib')
const QRCode = require('qrcode')

const __dirname = dirname(fileURLToPath(import.meta.url))
const raiz = join(__dirname, '..')
const app = join(raiz, 'apps', 'inventario')

// Node 24 ejecuta TypeScript quitando los tipos, pero no resuelve ni el alias
// `@/` de Next ni las importaciones sin extensión. Este gancho hace las dos
// cosas para poder probar los módulos REALES de la aplicación en vez de copiar
// su lógica aquí.
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.startsWith('@/')) {
      const base = join(app, spec.slice(2))
      for (const cand of [base, base + '.ts', base + '.tsx', join(base, 'index.ts')]) {
        if (existsSync(cand)) return { url: pathToFileURL(cand).href, shortCircuit: true }
      }
    }
    try {
      return next(spec, ctx)
    } catch (e) {
      if (/^[./]/.test(spec) && ctx.parentURL) {
        const url = new URL(spec + '.ts', ctx.parentURL)
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true }
      }
      throw e
    }
  },
})

const QR = await import(pathToFileURL(join(app, 'lib', 'puntos-qr.ts')).href)
const FIRMA = await import(pathToFileURL(join(app, 'lib', 'puntos-qr-firma.ts')).href)
const PLACAS = await import(
  pathToFileURL(join(app, 'app', '(dashboard)', 'rondas', 'qr', 'placas.ts')).href)

const salida = resolve(process.argv[2] ?? join(tmpdir(), 'placas-qr-f2'))
mkdirSync(salida, { recursive: true })

let ok = 0, fail = 0
const check = (titulo, cond, detalle = '') => {
  if (cond) { ok++; console.log(`  OK   ${titulo}${detalle ? ' · ' + detalle : ''}`) }
  else { fail++; console.log(`  FALLA ${titulo}${detalle ? ' · ' + detalle : ''}`) }
}


const MM = 2.8346   // 1 mm en puntos PostScript

/** Saca del PDF sin comprimir dónde se dibujó cada cosa, en milímetros y con el
 *  origen arriba a la izquierda (como se piensa una hoja, no como la numera el
 *  PDF). Sirve para comprobar que nada se sale de su placa: un texto que se
 *  desborda no lo detecta ningún conteo de páginas. */
function dibujos(bytes, altoMm) {
  const texto = Buffer.from(bytes).toString('latin1')
  const trazos = []
  // Texto: jsPDF escribe "x y Td" dentro de un bloque BT/ET.
  for (const m of texto.matchAll(/(-?[0-9.]+) (-?[0-9.]+) Td/g)) {
    trazos.push({ tipo: 'texto', x: Number(m[1]) / MM, y: altoMm - Number(m[2]) / MM })
  }
  // Imágenes: "a 0 0 d x y cm" coloca la imagen con su esquina inferior
  // izquierda en (x, y) y con tamaño (a, d).
  for (const m of texto.matchAll(/([0-9.]+) 0 0 ([0-9.]+) (-?[0-9.]+) (-?[0-9.]+) cm/g)) {
    const ancho = Number(m[1]) / MM
    const alto = Number(m[2]) / MM
    const x = Number(m[3]) / MM
    const y = Number(m[4]) / MM
    trazos.push({ tipo: 'imagen', x, y: altoMm - y - alto, ancho, alto })
  }
  return trazos
}

const BASE = 'https://ejemplo.vercel.app'
const SECRETO = 'llave-de-prueba-no-es-la-de-produccion'

// Siete puntos de mentira, con nombres de lugares y no de personas (este
// repositorio es público). Siete y no seis a propósito: así la hoja A4, que
// lleva 6, tiene que pasar a una segunda página.
const PUNTOS = [
  ['P-001', 'Portería principal', 'Torre A — piso 1'],
  ['P-002', 'Cuarto de basuras', 'Sótano 2'],
  ['P-003', 'Shut de basuras piso 5', 'Torre A — piso 5'],
  ['P-004', 'Salón comunal', 'Zona común'],
  ['P-005', 'Cuarto de máquinas del ascensor', 'Cubierta'],
  ['P-006', 'Parqueadero de visitantes', 'Sótano 1'],
  ['P-007', 'Tanque de agua potable', 'Cubierta'],
]

const placas = PUNTOS.map(([codigo, nombre, zonaPiso], i) => {
  const puntoId = `00000000-0000-4000-8000-00000000000${i + 1}`
  const clave = QR.ALFABETO_TOKEN.slice(i, i + 8).padEnd(8, 'Z')
  const { token } = FIRMA.armarToken({
    clavePublica: clave, puntoId, version: 1, llaveId: 'cli-demo-v1', secreto: SECRETO,
  })
  return {
    qrId: puntoId,
    token,
    // Código manual de mentira, con el alfabeto tecleable de verdad.
    codigoManual: QR.ALFABETO_MANUAL.slice(i * 3, i * 3 + 8).padEnd(8, 'K'),
    puntoCodigo: codigo,
    puntoNombre: nombre,
    sedeNombre: 'Conjunto Residencial de Prueba',
    zonaPiso,
    contratoNombre: 'Contrato de demostración',
    arteColor: '#1B5E20',
  }
})

console.log('\n1) El QR sale legible: 50 mm o más, con módulos sobre 0,4 mm')
for (const formato of QR.FORMATOS_LOTE) {
  const f = QR.FORMATOS[formato]
  check(`${formato}: el QR mide ${f.qr} mm de lado`, f.qr >= 50)
  // El tamaño del QR en módulos lo decide el contenido: la URL completa que va
  // impresa. Se mide con la misma librería que dibuja el QR.
  const url = QR.urlDelQr(placas[0].token, BASE)
  const simbolo = QRCode.create(url, { errorCorrectionLevel: 'Q' })
  const modulos = simbolo.modules.size
  const mmPorModulo = f.qr / modulos
  check(`${formato}: cada módulo queda en ${mmPorModulo.toFixed(2)} mm (mínimo 0,40)`,
    mmPorModulo >= 0.4,
    `${modulos}×${modulos} módulos para ${url.length} caracteres de URL`)
}

console.log('\n2) El PDF: páginas, tamaño de hoja y el código manual impreso')
for (const formato of QR.FORMATOS_LOTE) {
  const f = QR.FORMATOS[formato]
  const porHoja = QR.porHoja(formato)
  const esperadas = Math.ceil(placas.length / porHoja)

  const pdf = await PLACAS.armarPdfDeLote(placas, formato, BASE, { comprimir: false })
  const bytes = pdf.output('arraybuffer')
  const doc = await PDFDocument.load(bytes)

  check(`${formato}: ${placas.length} placas caben en ${esperadas} página(s) de ${porHoja}`,
    doc.getPageCount() === esperadas, `${doc.getPageCount()} páginas`)

  // 1 mm = 2,8346 puntos PostScript. Se compara con una tolerancia de medio
  // punto, que es el redondeo del propio formato de PDF.
  const pagina = doc.getPage(0)
  const anchoMm = pagina.getWidth() / 2.8346
  const altoMm = pagina.getHeight() / 2.8346
  check(`${formato}: la hoja mide ${f.ancho}×${f.alto} mm`,
    Math.abs(anchoMm - f.ancho) < 0.5 && Math.abs(altoMm - f.alto) < 0.5,
    `${anchoMm.toFixed(1)}×${altoMm.toFixed(1)} mm`)

  // El código manual tiene que estar IMPRESO, no solo guardado. Se busca en el
  // contenido del PDF sin comprimir, carácter por carácter: jsPDF escribe el
  // texto como una secuencia de glifos, así que se compara contra el texto con
  // y sin escapes.
  const texto = Buffer.from(bytes).toString('latin1')
  const agrupado = QR.formatearManual(placas[0].codigoManual)
  check(`${formato}: el código manual ${agrupado} queda impreso en la placa`,
    texto.includes(agrupado), agrupado)
  check(`${formato}: y también el código del punto (${placas[0].puntoCodigo})`,
    texto.includes(placas[0].puntoCodigo))
  check(`${formato}: y el nombre del punto`,
    texto.includes(placas[0].puntoNombre.split(' ')[0]))

  // La muestra se guarda COMPRIMIDA, que es como sale de la pantalla: el PDF
  // sin comprimir de arriba guarda cada QR como mapa de bits en claro y pesa
  // decenas de megas, y dejar eso como "muestra" daría una idea falsa de lo que
  // se va a descargar.
  const comprimido = await PLACAS.armarPdfDeLote(placas, formato, BASE)
  const bytesComprimidos = Buffer.from(comprimido.output('arraybuffer'))
  const archivo = join(salida, `placas-${formato.toLowerCase()}.pdf`)
  writeFileSync(archivo, bytesComprimidos)
  const kb = bytesComprimidos.length / 1024
  check(`${formato}: el PDF de ${placas.length} placas pesa ${kb.toFixed(0)} KB`,
    kb < 400, `límite razonable para descargar e imprimir: 400 KB`)
  console.log(`       muestra: ${archivo}`)
}

console.log('\n3) Nada se sale de su placa')
for (const formato of QR.FORMATOS_LOTE) {
  const f = QR.FORMATOS[formato]
  const celdaW = f.ancho / f.columnas
  const celdaH = f.alto / f.filas
  const pdf = await PLACAS.armarPdfDeLote(placas, formato, BASE, { comprimir: false })
  const trazos = dibujos(pdf.output('arraybuffer'), f.alto)

  // Cada trazo cae dentro de alguna celda de la retícula, con medio milímetro
  // de tolerancia por el redondeo del propio PDF.
  const fuera = trazos.filter((t) => {
    const col = Math.floor((t.x + 0.5) / celdaW)
    const fila = Math.floor((t.y + 0.5) / celdaH)
    if (col < 0 || col >= f.columnas || fila < 0 || fila >= f.filas) return true
    const derecha = t.x + (t.ancho ?? 0)
    const abajo = t.y + (t.alto ?? 0)
    return derecha > (col + 1) * celdaW + 0.5 || abajo > (fila + 1) * celdaH + 0.5
  })
  check(`${formato}: ningún texto ni imagen se sale de su placa`,
    fuera.length === 0,
    fuera.length
      ? fuera.slice(0, 3).map((t) => `${t.tipo}@${t.x.toFixed(1)},${t.y.toFixed(1)}`).join(' ')
      : `${trazos.length} trazos revisados`)

  const qrDibujado = trazos.find((t) => t.tipo === 'imagen' && Math.abs(t.ancho - f.qr) < 0.5)
  check(`${formato}: el QR se dibujó a ${f.qr} mm de lado`,
    !!qrDibujado && Math.abs(qrDibujado.alto - f.qr) < 0.5,
    qrDibujado ? `${qrDibujado.ancho.toFixed(1)}×${qrDibujado.alto.toFixed(1)} mm` : 'no se encontró')
  check(`${formato}: y queda centrado en la placa`,
    !!qrDibujado && Math.abs((qrDibujado.x % celdaW) + f.qr / 2 - celdaW / 2) < 0.6,
    qrDibujado ? `x=${(qrDibujado.x % celdaW).toFixed(1)} mm` : '')
}

console.log('\n3) Casos de borde')
const vacio = await PLACAS.armarPdfDeLote([], 'HOJA_A4', BASE).then(() => null, (e) => e)
check('un lote sin placas no genera PDF, avisa', vacio instanceof Error, vacio?.message)

const unaSola = await PLACAS.armarPdfDeLote([placas[0]], 'HOJA_A4', BASE)
check('una sola placa en la hoja A4 genera una página',
  (await PDFDocument.load(unaSola.output('arraybuffer'))).getPageCount() === 1)

const colorMalo = await PLACAS.armarPdfDeLote(
  [{ ...placas[0], arteColor: 'no-es-un-color' }], 'PLACA_A6', BASE)
check('un color de contrato inservible no rompe la impresión (cae al verde de la marca)',
  (await PDFDocument.load(colorMalo.output('arraybuffer'))).getPageCount() === 1)

console.log(`\n${ok} pruebas bien, ${fail} mal. Muestras en ${salida}`)
process.exit(fail > 0 ? 1 : 0)

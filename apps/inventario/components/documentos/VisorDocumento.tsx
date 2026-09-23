'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Printer, FileText, Type } from 'lucide-react'
import { documentoCompleto } from '@/lib/documentos/html'

/** Ancho de una hoja carta en pantalla (8,5 in a 96 ppp). */
const ANCHO_HOJA = 816
/** Ancho mínimo al que se acomoda el texto en modo lectura (más angosto, se reduce). */
const ANCHO_LECTURA_MIN = 360

export type ModoVista = 'hoja' | 'lectura'

/**
 * Muestra un documento generado en un marco aislado (sin scripts) con el
 * estilo de impresión, y permite imprimirlo o guardarlo como PDF.
 *
 * Con espacio de sobra se ve la hoja carta a tamaño real. En pantallas más
 * angostas (celular) hay dos vistas: «lectura», con el texto acomodado al ancho
 * de la pantalla y a tamaño normal, y «hoja», con la carta completa reducida.
 *
 * `cuerpo` debe venir ya limpio y con los marcadores resueltos
 * (`htmlParaMostrar` de lib/documentos/html).
 */
export function VisorDocumento({
  cuerpo, titulo, alturaMax = '70vh', mostrarImprimir = true, vistaInicial = 'hoja',
}: {
  cuerpo: string
  titulo: string
  alturaMax?: string
  mostrarImprimir?: boolean
  /** Vista en pantallas angostas: el candidato lee en «lectura»; quien diseña formatos, en «hoja». */
  vistaInicial?: ModoVista
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const caja = useRef<HTMLDivElement>(null)
  const [alto, setAlto] = useState(1000)
  const [disponible, setDisponible] = useState(ANCHO_HOJA)
  const [vista, setVista] = useState<ModoVista>(vistaInicial)

  const angosto = disponible < ANCHO_HOJA - 8
  const anchoMarco = !angosto || vista === 'hoja' ? ANCHO_HOJA : Math.max(Math.floor(disponible), ANCHO_LECTURA_MIN)
  const escala = Math.min(1, disponible / anchoMarco)

  const medir = useCallback(() => {
    const doc = ref.current?.contentDocument
    if (!doc?.body) return
    // El alto del cuerpo (no el del marco): así también se encoge al ensanchar.
    setAlto(Math.max(300, Math.ceil(doc.body.scrollHeight) + 8))
  }, [])

  useEffect(() => {
    const el = caja.current
    if (!el) return
    const actualizar = () => {
      const estilo = getComputedStyle(el)
      setDisponible(el.clientWidth - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight))
    }
    actualizar()
    const ro = new ResizeObserver(actualizar)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Al cambiar el ancho el texto se reacomoda y cambia el alto.
  useEffect(() => {
    const id = requestAnimationFrame(medir)
    return () => cancelAnimationFrame(id)
  }, [anchoMarco, medir])

  return (
    <div className="space-y-2">
      {(mostrarImprimir || angosto) && (
        <div className="flex flex-wrap justify-end gap-2">
          {angosto && (
            <button type="button" onClick={() => setVista((v) => (v === 'hoja' ? 'lectura' : 'hoja'))}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              {vista === 'hoja' ? <><Type className="h-3.5 w-3.5" /> Letra grande</> : <><FileText className="h-3.5 w-3.5" /> Ver la hoja completa</>}
            </button>
          )}
          {mostrarImprimir && (
            <button type="button" onClick={() => ref.current?.contentWindow?.print()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
              <Printer className="h-3.5 w-3.5" /> Imprimir / guardar PDF
            </button>
          )}
        </div>
      )}
      <div ref={caja} className="overflow-auto rounded-xl border border-gray-200 bg-gray-100 p-1.5 sm:p-4" style={{ maxHeight: alturaMax }}>
        <div className="mx-auto overflow-hidden rounded bg-white shadow-sm" style={{ width: anchoMarco * escala, height: alto * escala }}>
          <iframe
            ref={ref}
            title={titulo}
            // Sin allow-scripts: el HTML de la plantilla nunca ejecuta código.
            // allow-same-origin deja medir el alto; allow-modals deja imprimir.
            sandbox="allow-same-origin allow-modals"
            srcDoc={documentoCompleto(cuerpo, titulo)}
            onLoad={medir}
            className="block bg-white"
            style={{ width: anchoMarco, height: alto, border: 0, transform: `scale(${escala})`, transformOrigin: 'top left' }}
          />
        </div>
      </div>
    </div>
  )
}

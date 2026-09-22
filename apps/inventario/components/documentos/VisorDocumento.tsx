'use client'

import { useCallback, useRef, useState } from 'react'
import { Printer } from 'lucide-react'
import { documentoCompleto } from '@/lib/documentos/html'

/**
 * Muestra un documento generado en un marco aislado (sin scripts) con el
 * estilo de impresión, y permite imprimirlo o guardarlo como PDF.
 *
 * `cuerpo` debe venir ya limpio y con los marcadores resueltos
 * (`htmlParaMostrar` de lib/documentos/html).
 */
export function VisorDocumento({
  cuerpo, titulo, alturaMax = '70vh', mostrarImprimir = true,
}: {
  cuerpo: string
  titulo: string
  alturaMax?: string
  mostrarImprimir?: boolean
}) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [alto, setAlto] = useState(600)

  const medir = useCallback(() => {
    const doc = ref.current?.contentDocument
    if (!doc) return
    setAlto(Math.max(300, doc.documentElement.scrollHeight + 8))
  }, [])

  return (
    <div className="space-y-2">
      {mostrarImprimir && (
        <div className="flex justify-end">
          <button type="button" onClick={() => ref.current?.contentWindow?.print()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50">
            <Printer className="h-3.5 w-3.5" /> Imprimir / guardar PDF
          </button>
        </div>
      )}
      <div className="overflow-auto rounded-xl border border-gray-200 bg-gray-100 p-2 sm:p-4" style={{ maxHeight: alturaMax }}>
        <iframe
          ref={ref}
          title={titulo}
          // Sin allow-scripts: el HTML de la plantilla nunca ejecuta código.
          // allow-same-origin deja medir el alto; allow-modals deja imprimir.
          sandbox="allow-same-origin allow-modals"
          srcDoc={documentoCompleto(cuerpo, titulo)}
          onLoad={medir}
          className="mx-auto block w-full max-w-[850px] rounded bg-white shadow-sm"
          style={{ height: alto, border: 0 }}
        />
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { FileDown, Loader2, Truck, ClipboardList } from 'lucide-react'
import { toast } from 'sonner'

export interface DatosDoc {
  numero: string
  estado: string
  created_at: string
  aprobado_at?: string | null
  despachado_at?: string | null
  observacion: string | null
  sede: string
  grupo: string | null
  bodega: string | null
  responsables: string[]
  items: {
    nombre: string
    presentacion: string | null
    solicitada: number
    alistada: number
  }[]
}

type Tipo = 'ORDEN' | 'REMISION'

const EMPRESA = { nombre: 'CONSERJES INMOBILIARIOS LTDA', nit: 'NIT 800093388-2', tel: '+57 320 808 1399' }

function fecha(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * Genera el PDF (orden de insumo / remisión de despacho) para imprimir y
 * enviarlo físicamente con el pedido. Se construye en el navegador con
 * @react-pdf/renderer (import dinámico: la librería es pesada y es client-only).
 */
export function DocumentosPDF({ datos }: { datos: DatosDoc }) {
  const [generando, setGenerando] = useState<Tipo | null>(null)

  async function generar(tipo: Tipo) {
    setGenerando(tipo)
    try {
      const { pdf, Document, Page, Text, View, StyleSheet } = await import('@react-pdf/renderer')
      const React = (await import('react')).default
      const h = React.createElement

      const s = StyleSheet.create({
        page: { padding: 34, fontSize: 9, fontFamily: 'Helvetica', color: '#111827' },
        empresa: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
        sub: { fontSize: 8, color: '#6b7280' },
        titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
        numero: { fontSize: 11, textAlign: 'right', color: '#2E7D32', fontFamily: 'Helvetica-Bold' },
        head: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: '#2E7D32', paddingBottom: 8, marginBottom: 12 },
        box: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4, padding: 8, marginBottom: 10 },
        row: { flexDirection: 'row', marginBottom: 3 },
        lbl: { width: 90, color: '#6b7280' },
        val: { flex: 1, fontFamily: 'Helvetica-Bold' },
        th: { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 5, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold' },
        tr: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
        cProd: { flex: 1 }, cNum: { width: 70, textAlign: 'right' },
        firma: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 34 },
        firmaBox: { width: '45%', borderTopWidth: 1, borderTopColor: '#111827', paddingTop: 4, fontSize: 8, textAlign: 'center' },
        pie: { position: 'absolute', bottom: 22, left: 34, right: 34, fontSize: 7, color: '#9ca3af', textAlign: 'center' },
      })

      const esRemision = tipo === 'REMISION'
      const cantLabel = esRemision ? 'DESPACHADO' : 'SOLICITADO'
      const cantOf = (i: DatosDoc['items'][number]) => (esRemision ? i.alistada : i.solicitada)
      const total = datos.items.reduce((a, i) => a + cantOf(i), 0)

      const doc = h(Document, { title: `${tipo}-${datos.numero}` },
        h(Page, { size: 'LETTER', style: s.page },
          // Encabezado
          h(View, { style: s.head },
            h(View, null,
              h(Text, { style: s.empresa }, EMPRESA.nombre),
              h(Text, { style: s.sub }, `${EMPRESA.nit} · ${EMPRESA.tel}`),
            ),
            h(View, null,
              h(Text, { style: s.titulo }, esRemision ? 'REMISIÓN DE DESPACHO' : 'ORDEN DE INSUMO'),
              h(Text, { style: s.numero }, datos.numero),
            ),
          ),
          // Datos
          h(View, { style: s.box },
            h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Sede destino'), h(Text, { style: s.val }, datos.sede)),
            datos.grupo ? h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Contrato'), h(Text, { style: s.val }, datos.grupo)) : null,
            h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Bodega'), h(Text, { style: s.val }, datos.bodega ?? '—')),
            h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Fecha solicitud'), h(Text, { style: s.val }, fecha(datos.created_at))),
            h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Aprobación'), h(Text, { style: s.val }, fecha(datos.aprobado_at))),
            esRemision ? h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Despacho'), h(Text, { style: s.val }, fecha(datos.despachado_at))) : null,
            datos.responsables.length
              ? h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Responsables'), h(Text, { style: s.val }, datos.responsables.join(', ')))
              : null,
          ),
          // Tabla
          h(View, { style: s.th },
            h(Text, { style: s.cProd }, 'PRODUCTO'),
            h(Text, { style: s.cNum }, cantLabel),
          ),
          ...datos.items.map((i, k) =>
            h(View, { style: s.tr, key: String(k), wrap: false },
              h(View, { style: s.cProd },
                h(Text, null, i.nombre),
                i.presentacion ? h(Text, { style: s.sub }, i.presentacion) : null,
              ),
              h(Text, { style: s.cNum }, String(cantOf(i))),
            ),
          ),
          h(View, { style: [s.tr, { borderBottomWidth: 0, backgroundColor: '#f9fafb' }] },
            h(Text, { style: [s.cProd, { fontFamily: 'Helvetica-Bold' }] }, `TOTAL · ${datos.items.length} ítem(s)`),
            h(Text, { style: [s.cNum, { fontFamily: 'Helvetica-Bold' }] }, String(total)),
          ),
          datos.observacion
            ? h(View, { style: [s.box, { marginTop: 10 }] },
                h(Text, { style: s.sub }, 'Observaciones'),
                h(Text, null, datos.observacion),
              )
            : null,
          // Firmas — la remisión viaja con la mercancía y se firma al recibir
          h(View, { style: s.firma },
            h(Text, { style: s.firmaBox }, esRemision ? 'Entregado por (bodega)' : 'Solicitado por (coordinador)'),
            h(Text, { style: s.firmaBox }, esRemision ? 'Recibido por (sede) — nombre, C.C. y fecha' : 'Aprobado por (central)'),
          ),
          h(Text, { style: s.pie }, `${EMPRESA.nombre} · Documento generado por la plataforma · ${new Date().toLocaleString('es-CO')}`),
        ),
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const blob = await pdf(doc as any).toBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${esRemision ? 'Remision' : 'Orden'}_${datos.numero}.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`${esRemision ? 'Remisión' : 'Orden'} generada`)
    } catch (e) {
      toast.error('No se pudo generar el PDF: ' + (e instanceof Error ? e.message : 'error'))
    } finally {
      setGenerando(null)
    }
  }

  const aprobada = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO'].includes(datos.estado)

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <FileDown className="w-4 h-4 text-brand-green" />
        <h2 className="font-heading font-semibold text-base text-gray-900">Documentos para imprimir</h2>
      </div>
      <p className="font-body text-sm text-gray-500 mb-3">
        La <strong>remisión</strong> se imprime y viaja físicamente con el pedido; la firma quien recibe en la sede.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => generar('ORDEN')} disabled={generando !== null}
          className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-4 py-2 font-body text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
          {generando === 'ORDEN' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />} Orden de insumo (PDF)
        </button>
        <button onClick={() => generar('REMISION')} disabled={generando !== null || !aprobada}
          title={aprobada ? '' : 'Disponible cuando la central apruebe la orden'}
          className="flex items-center gap-1.5 bg-brand-green text-white rounded-lg px-4 py-2 font-body font-semibold text-sm hover:bg-brand-green-dark disabled:opacity-50">
          {generando === 'REMISION' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Remisión de despacho (PDF)
        </button>
      </div>
      {!aprobada && (
        <p className="font-body text-xs text-amber-700 mt-2">La remisión se habilita cuando la orden está aprobada.</p>
      )}
    </div>
  )
}

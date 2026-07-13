import type { Metadata } from 'next'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { ImprimirToolbar } from './ImprimirToolbar'

export const metadata: Metadata = { title: 'Orden de compra — Impresión' }
export const dynamic = 'force-dynamic'

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })
const fecha = (v: string | null | undefined) => (v ? new Date(v).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }) : '—')

const ESTADO_LABEL: Record<string, string> = {
  BORRADOR: 'Borrador', APROBADA: 'Aprobada', ENVIADA: 'Comprada', PARCIAL: 'Recepción parcial', COMPLETA: 'Recibida', ANULADA: 'Anulada',
}

interface OCItemRow {
  cantidad_ped: number; precio_unit: number; subtotal: number | null
  producto: { nombre_estandar: string; presentacion: string | null } | null
}

export default async function OCImprimirPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePermiso('ver_ordenes_compra')
  const { id } = await params
  const supabase = await createClient()

  const { data: oc } = await supabase
    .from('ordenes_compra')
    .select('*, proveedor:proveedores ( nombre, nit, contacto, telefono, email )')
    .eq('id', id)
    .single()
  if (!oc) notFound()

  const { data: items } = await supabase
    .from('oc_items')
    .select('cantidad_ped, precio_unit, subtotal, producto:productos ( nombre_estandar, presentacion )')
    .eq('oc_id', id)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const o = oc as any
  const prov = o.proveedor as { nombre: string; nit: string | null; contacto: string | null; telefono: string | null; email: string | null } | null
  const lineas = (items as unknown as OCItemRow[]) ?? []
  const total = lineas.reduce((a, it) => a + Number(it.subtotal ?? Number(it.cantidad_ped) * Number(it.precio_unit)), 0)

  return (
    <>
      {/* Estilos de página para impresión */}
      <style>{`@media print { @page { size: A4; margin: 14mm; } html, body { background: #fff !important; } }`}</style>

      <ImprimirToolbar ocId={id} />

      {/* Documento */}
      <div className="mx-auto my-6 max-w-[820px] bg-white p-10 shadow-sm print:my-0 print:max-w-none print:p-0 print:shadow-none">
        {/* Encabezado */}
        <div className="flex items-start justify-between gap-6 border-b-2 border-gray-800 pb-4">
          <div className="flex items-center gap-3">
            <Image src="/icon.png" alt="Logo" width={54} height={54} className="rounded-lg" />
            <div>
              <p className="font-heading text-lg font-bold leading-tight text-gray-900">Conserjes Inmobiliarios Ltda.</p>
              <p className="font-body text-xs text-gray-500">Control de inventarios y compras</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-heading text-xl font-bold tracking-wide text-gray-900">ORDEN DE COMPRA</p>
            <p className="font-mono text-sm text-gray-700">{o.numero_oc}</p>
            <span className="mt-1 inline-block rounded border border-gray-300 px-2 py-0.5 font-body text-[11px] font-semibold text-gray-600">
              {ESTADO_LABEL[o.estado] ?? o.estado}
            </span>
          </div>
        </div>

        {/* Proveedor + datos */}
        <div className="mt-6 grid grid-cols-2 gap-6">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="mb-2 font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400">Proveedor</p>
            <p className="font-heading text-sm font-bold text-gray-900">{prov?.nombre ?? '—'}</p>
            {prov?.nit && <p className="font-body text-xs text-gray-600">NIT {prov.nit}</p>}
            {prov?.contacto && <p className="font-body text-xs text-gray-600">Contacto: {prov.contacto}</p>}
            {prov?.telefono && <p className="font-body text-xs text-gray-600">Tel: {prov.telefono}</p>}
            {prov?.email && <p className="font-body text-xs text-gray-600">{prov.email}</p>}
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="mb-2 font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400">Datos de la orden</p>
            <dl className="space-y-1 font-body text-xs text-gray-700">
              <Row k="Emisión" v={fecha(o.fecha_emision)} />
              <Row k="Período" v={o.periodo ? new Date(o.periodo).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' }) : '—'} />
              <Row k="Entrega esperada" v={fecha(o.fecha_entrega)} />
              {o.fecha_aprobacion && <Row k="Aprobada" v={fecha(o.fecha_aprobacion)} />}
              {o.fecha_envio && <Row k="Comprada" v={fecha(o.fecha_envio)} />}
              {o.fecha_recepcion && <Row k="Recibida" v={fecha(o.fecha_recepcion)} />}
            </dl>
          </div>
        </div>

        {/* Ítems */}
        <table className="mt-6 w-full border-collapse text-sm">
          <thead>
            <tr className="border-y-2 border-gray-800 text-left font-body text-[11px] uppercase tracking-wide text-gray-600">
              <th className="py-2 pr-2 font-semibold">#</th>
              <th className="py-2 pr-2 font-semibold">Producto</th>
              <th className="py-2 px-2 text-right font-semibold">Cant.</th>
              <th className="py-2 px-2 text-right font-semibold">Precio unit.</th>
              <th className="py-2 pl-2 text-right font-semibold">Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {lineas.map((it, i) => (
              <tr key={i} className="border-b border-gray-200 align-top">
                <td className="py-2 pr-2 font-body text-gray-500">{i + 1}</td>
                <td className="py-2 pr-2 font-body text-gray-900">
                  {it.producto?.nombre_estandar ?? '—'}
                  {it.producto?.presentacion && <span className="block text-xs text-gray-500">{it.producto.presentacion}</span>}
                </td>
                <td className="py-2 px-2 text-right font-body text-gray-700">{Number(it.cantidad_ped)}</td>
                <td className="py-2 px-2 text-right font-body text-gray-700">{cop.format(Number(it.precio_unit))}</td>
                <td className="py-2 pl-2 text-right font-body font-semibold text-gray-900">{cop.format(Number(it.subtotal ?? Number(it.cantidad_ped) * Number(it.precio_unit)))}</td>
              </tr>
            ))}
            {lineas.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center font-body text-sm text-gray-400">Esta orden no tiene ítems.</td></tr>
            )}
          </tbody>
        </table>

        {/* Total */}
        <div className="mt-4 flex justify-end">
          <div className="w-64 rounded-lg bg-gray-50 p-4 print:bg-gray-100">
            <div className="flex items-center justify-between">
              <span className="font-body text-sm text-gray-600">Valor total</span>
              <span className="font-heading text-xl font-bold text-gray-900">{cop.format(o.valor_total ?? total)}</span>
            </div>
          </div>
        </div>

        {/* Observaciones */}
        {o.observaciones && (
          <div className="mt-6">
            <p className="mb-1 font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400">Observaciones</p>
            <p className="font-body text-sm text-gray-700 whitespace-pre-wrap">{o.observaciones}</p>
          </div>
        )}

        {/* Firmas */}
        <div className="mt-16 grid grid-cols-3 gap-8">
          {['Elaboró', 'Aprobó', 'Recibió'].map(rol => (
            <div key={rol} className="text-center">
              <div className="border-t border-gray-400 pt-1 font-body text-xs text-gray-600">{rol}</div>
            </div>
          ))}
        </div>

        <p className="mt-10 text-center font-body text-[10px] text-gray-400">
          Documento generado desde la plataforma de Conserjes Inmobiliarios · {o.numero_oc}
        </p>
      </div>
    </>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-400">{k}</dt>
      <dd className="font-medium text-gray-800">{v}</dd>
    </div>
  )
}

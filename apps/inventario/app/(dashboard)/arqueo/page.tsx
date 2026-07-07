import type { Metadata } from 'next'
import Link from 'next/link'
import { ClipboardCheck, Plus, CheckCircle2, Clock, Ban } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'

export const metadata: Metadata = { title: 'Arqueo de inventario' }
export const revalidate = 0

interface ArqueoRow {
  id: string
  nombre: string
  descripcion: string | null
  estado: 'ABIERTO' | 'CERRADO' | 'ANULADO'
  total_items: number
  items_contados: number
  items_con_diferencia: number
  valor_diferencia: number | null
  created_at: string
  cerrado_at: string | null
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

const ESTADO = {
  ABIERTO: { label: 'En progreso', cls: 'bg-blue-100 text-blue-700', icon: Clock },
  CERRADO: { label: 'Cerrado', cls: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  ANULADO: { label: 'Anulado', cls: 'bg-gray-100 text-gray-500', icon: Ban },
}

export default async function ArqueoPage() {
  await requirePermiso('ver_arqueo')
  const supabase = await createClient()
  const { data } = await supabase
    .from('arqueos')
    .select('id, nombre, descripcion, estado, total_items, items_contados, items_con_diferencia, valor_diferencia, created_at, cerrado_at')
    .order('created_at', { ascending: false })
    .limit(50)

  const arqueos = (data as unknown as ArqueoRow[]) ?? []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
            <ClipboardCheck className="w-6 h-6 text-brand-green" /> Arqueo de inventario
          </h1>
          <p className="font-body text-sm text-gray-500 mt-0.5">
            Conteo físico colaborativo. Verifica lo que hay en bodega y ajusta diferencias.
          </p>
        </div>
        <Link href="/arqueo/nuevo"
          className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark transition-colors shadow-sm">
          <Plus className="w-4 h-4" /> Nuevo arqueo
        </Link>
      </div>

      {arqueos.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <ClipboardCheck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">Aún no hay arqueos</p>
          <p className="font-body text-sm mt-1">Inicia el primer conteo físico de inventario.</p>
          <Link href="/arqueo/nuevo" className="inline-block mt-4 text-brand-green font-body font-semibold text-sm hover:underline">Nuevo arqueo →</Link>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {arqueos.map(a => {
            const e = ESTADO[a.estado]
            const Icon = e.icon
            const progreso = a.total_items > 0 ? Math.round((a.items_contados / a.total_items) * 100) : 0
            return (
              <Link key={a.id} href={`/arqueo/${a.id}`}
                className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm hover:shadow-md hover:border-brand-green/30 transition-all">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-heading font-bold text-base text-gray-900 line-clamp-1">{a.nombre}</h3>
                  <span className={`inline-flex items-center gap-1 font-body text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${e.cls}`}>
                    <Icon className="w-3 h-3" /> {e.label}
                  </span>
                </div>
                {a.descripcion && <p className="font-body text-xs text-gray-400 line-clamp-1 mb-3">{a.descripcion}</p>}

                {a.estado === 'ABIERTO' ? (
                  <>
                    <div className="flex justify-between font-body text-xs text-gray-500 mb-1">
                      <span>{a.items_contados} de {a.total_items} contados</span><span>{progreso}%</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-green rounded-full" style={{ width: `${progreso}%` }} />
                    </div>
                  </>
                ) : (
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div className="rounded-lg bg-gray-50 p-2 text-center">
                      <p className="font-heading font-bold text-lg text-gray-900">{a.items_con_diferencia}</p>
                      <p className="font-body text-xs text-gray-500">con diferencia</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-2 text-center">
                      <p className={`font-heading font-bold text-lg ${(a.valor_diferencia ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {cop.format(a.valor_diferencia ?? 0)}
                      </p>
                      <p className="font-body text-xs text-gray-500">impacto</p>
                    </div>
                  </div>
                )}
                <p className="font-body text-xs text-gray-300 mt-3">
                  {new Date(a.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                </p>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { MovimientosBatchClient } from './MovimientosBatchClient'
import type { TipoMovimiento } from '@/lib/types/database'
import { requirePermiso } from '@/lib/permisos-server'

export const metadata: Metadata = { title: 'Registrar movimiento' }

const TIPOS_VALIDOS: TipoMovimiento[] = ['ENTRADA', 'SALIDA', 'DEVOLUCION', 'AJUSTE', 'TRASLADO']

interface Props { searchParams: Promise<{ producto?: string; tipo?: string }> }

export default async function NuevoMovimientoPage({ searchParams }: Props) {
  await requirePermiso('crear_movimientos', '/movimientos')
  const { producto, tipo } = await searchParams
  const supabase = await createClient()

  const [productos, { data: sedes }, { data: ubicData }, { data: ordData }, { data: usuData }, { data: borrData }] = await Promise.all([
    // `.limit(5000)` NO sirve: PostgREST corta en 1.000 filas. Hay que paginar.
    traerTodo((desde, hasta) => supabase
      .from('productos').select('id, nombre_estandar, presentacion, codigo, imagen_url')
      .eq('activo', true).order('nombre_estandar').order('id').range(desde, hasta)),
    traerTodo((desde, hasta) => supabase.from('sedes').select('id, nombre').eq('activo', true).order('nombre').order('id').range(desde, hasta)).then((data) => ({ data })),
    supabase.from('ubicaciones').select('id, codigo, nombre, bodega:bodegas ( nombre )').eq('activo', true).order('codigo'),
    // Órdenes de insumo (para cargar devoluciones): recientes, no anuladas.
    // Se traen bastantes porque el selector busca en el cliente (número/sede/estado).
    supabase.from('ordenes_insumo').select('id, numero, estado, created_at, sede_id, sede:sedes ( nombre )').neq('estado', 'ANULADA').order('created_at', { ascending: false }).limit(600),
    supabase.from('usuarios_opciones').select('id, nombre').order('nombre'),
    supabase.from('movimiento_borradores')
      .select('id, nombre, created_at, items:movimiento_borrador_items ( tipo, producto_id, cantidad, sede_id, ubicacion_id, observacion, orden ), responsables:movimiento_borrador_responsables ( usuario_id )')
      .order('created_at', { ascending: false }).limit(50),
  ])

  const ubicaciones = ((ubicData as unknown as { id: string; codigo: string; nombre: string | null; bodega: { nombre: string } | null }[]) ?? [])
    .map(u => ({ id: u.id, label: `${u.bodega?.nombre ?? 'Bodega'} · ${u.codigo}${u.nombre ? ` (${u.nombre})` : ''}` }))

  const ordenes = ((ordData as unknown as {
    id: string; numero: string; estado: string; created_at: string
    sede_id: string | null; sede: { nombre: string } | null
  }[]) ?? [])
    .map(o => ({
      id: o.id, numero: o.numero, estado: o.estado, created_at: o.created_at,
      sede_id: o.sede_id, sede_nombre: o.sede?.nombre ?? null,
    }))

  const usuarios = ((usuData as unknown as { id: string; nombre: string }[]) ?? [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const borradores = ((borrData as unknown as any[]) ?? []).map(b => ({
    id: b.id, nombre: b.nombre, created_at: b.created_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: (b.items ?? []).map((it: any) => ({
      tipo: it.tipo, producto_id: it.producto_id, cantidad: it.cantidad != null ? Number(it.cantidad) : null,
      sede_id: it.sede_id, ubicacion_id: it.ubicacion_id, observacion: it.observacion, orden: it.orden ?? 0,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    responsableIds: (b.responsables ?? []).map((r: any) => r.usuario_id),
  }))

  const initialTipo = tipo && TIPOS_VALIDOS.includes(tipo as TipoMovimiento) ? (tipo as TipoMovimiento) : undefined

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <Link href="/movimientos" className="inline-flex items-center gap-1.5 font-body text-sm text-gray-500 hover:text-brand-green mb-2">
          <ArrowLeft className="w-4 h-4" /> Volver a movimientos
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Registrar movimientos</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Registra varios movimientos a la vez. El stock se actualiza automáticamente según cada tipo.
        </p>
      </div>

      <MovimientosBatchClient productos={productos ?? []} sedes={sedes ?? []} ubicaciones={ubicaciones} ordenes={ordenes} usuarios={usuarios} borradores={borradores} initialProducto={producto} initialTipo={initialTipo} />
    </div>
  )
}

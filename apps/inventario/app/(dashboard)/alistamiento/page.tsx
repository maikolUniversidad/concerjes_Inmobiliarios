import type { Metadata } from 'next'
import Link from 'next/link'
import { PackageCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { AlistamientoClient, type Fila } from './AlistamientoClient'

export const metadata: Metadata = { title: 'Alistamiento' }
export const revalidate = 0

/** Estados que YA pasaron la aprobación de la central y viven en bodega. */
const ESTADOS_ALISTAMIENTO = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO']

/** Los `numeric` de PostgREST llegan como string. */
const n = (v: unknown) => Number(v ?? 0) || 0

export default async function AlistamientoPage() {
  await requirePermiso('ver_alistamiento')
  const supabase = await createClient()

  // Una fila por orden, con los contadores (ítems, alistados, sin stock,
  // pendiente de envío, unidades) y los responsables ya resueltos en SQL por
  // `v_alistamiento_lista`.
  //
  // Antes se traía las órdenes con sus ítems anidados y, de cada ítem, su
  // producto y su stock, solo para calcular esos números: ~6.300 ítems por
  // carga, 1.099 ms de media y picos de 5.838 ms medidos en pg_stat_statements.
  // Como `authenticated` tiene statement_timeout = 8 s, con la base ocupada se
  // pasaba del tope, PostgREST devolvía 500 y la pantalla caía en el aviso de
  // "Esta pantalla no se pudo cargar". Los responsables, además, eran ~5
  // peticiones encadenadas en lotes de 60 órdenes.
  //
  // Sigue paginado: la cola se muestra completa y PostgREST corta toda
  // respuesta en 1.000 filas.
  const filas = await traerTodo<Record<string, unknown>>((desde, hasta) => supabase
    .from('v_alistamiento_lista')
    .select(`
      id, numero, estado, sede, created_at, aprobado_at, despachado_at,
      alistado_at, tomado_ruta_at, recibido_at, total_items, alistados,
      sin_stock, pend_items, pend_unidades, und_pedido, und_alistado,
      und_despachado, responsables
    `)
    .in('estado', ESTADOS_ALISTAMIENTO)
    .order('aprobado_at', { ascending: false, nullsFirst: false }).order('id')
    .range(desde, hasta))

  const ordenes: Fila[] = filas.map((o) => ({
    id: o.id as string,
    numero: o.numero as string,
    estado: o.estado as string,
    created_at: o.created_at as string,
    aprobado_at: (o.aprobado_at as string | null) ?? null,
    despachado_at: (o.despachado_at as string | null) ?? null,
    alistado_at: (o.alistado_at as string | null) ?? null,
    tomado_ruta_at: (o.tomado_ruta_at as string | null) ?? null,
    recibido_at: (o.recibido_at as string | null) ?? null,
    sede: (o.sede as string | null) ?? null,
    total_items: n(o.total_items),
    alistados: n(o.alistados),
    sin_stock: n(o.sin_stock),
    pend_items: n(o.pend_items),
    pend_unidades: n(o.pend_unidades),
    und_pedido: n(o.und_pedido),
    und_alistado: n(o.und_alistado),
    und_despachado: n(o.und_despachado),
    responsables: (o.responsables as string[] | null) ?? [],
  }))

  const pendientes = ordenes.filter((o) => o.estado !== 'DESPACHADO').length

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <PackageCheck className="w-6 h-6 text-brand-green" /> Alistamiento
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Órdenes de insumo <strong>ya aprobadas</strong> por la central. Aquí bodega alista y despacha.
          {pendientes > 0 && ` · ${pendientes} por trabajar`}
        </p>
      </div>

      {ordenes.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center text-gray-400">
          <PackageCheck className="w-10 h-10 mx-auto mb-3 text-gray-300" />
          <p className="font-heading font-bold text-lg text-gray-600">No hay órdenes aprobadas</p>
          <p className="font-body text-sm mt-1">
            Las órdenes aparecen aquí cuando la central aprueba la propuesta del coordinador de sede.
          </p>
          <Link href="/ordenes-insumo" className="inline-block mt-3 text-brand-green font-body font-semibold text-sm hover:underline">
            Ver órdenes de insumo →
          </Link>
        </div>
      ) : (
        <AlistamientoClient ordenes={ordenes} />
      )}
    </div>
  )
}

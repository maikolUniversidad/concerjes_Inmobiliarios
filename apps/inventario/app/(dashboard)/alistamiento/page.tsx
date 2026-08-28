import type { Metadata } from 'next'
import Link from 'next/link'
import { PackageCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo, traerTodoPorIds } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { AlistamientoClient, type Fila } from './AlistamientoClient'

export const metadata: Metadata = { title: 'Alistamiento' }
export const revalidate = 0

/** Estados que YA pasaron la aprobación de la central y viven en bodega. */
const ESTADOS_ALISTAMIENTO = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO']

export default async function AlistamientoPage() {
  await requirePermiso('ver_alistamiento')
  const supabase = await createClient()

  // Paginado: la cola de alistamiento se muestra completa y PostgREST corta en
  // 1.000 filas por respuesta.
  const ordenes = (await traerTodo((desde, hasta) => supabase
    .from('ordenes_insumo')
    .select('id, numero, estado, created_at, aprobado_at, sede:sede_id ( nombre ), items:orden_insumo_items ( alistado, cantidad_solicitada, cantidad_alistada )')
    .in('estado', ESTADOS_ALISTAMIENTO)
    .order('aprobado_at', { ascending: false, nullsFirst: false }).order('id')
    .range(desde, hasta))) as unknown as Fila[]
  const pendientes = ordenes.filter((o) => o.estado !== 'DESPACHADO').length

  // Responsables por orden (vista que salta la RLS de usuarios para exponer solo el nombre)
  const responsables: Record<string, string[]> = {}
  if (ordenes.length > 0) {
    const resp = await traerTodoPorIds<{ orden_id: string; nombre: string }>(
      ordenes.map((o) => o.id),
      (lote, desde, hasta) => supabase
        .from('responsables_opciones')
        .select('orden_id, nombre')
        .in('orden_id', lote)
        // (orden_id, usuario_id) es la clave única de la vista: hace falta un
        // desempate único para que la paginación por OFFSET sea estable.
        .order('orden_id').order('usuario_id')
        .range(desde, hasta),
    )
    for (const r of resp) {
      (responsables[r.orden_id] ??= []).push(r.nombre)
    }
  }

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
        <AlistamientoClient ordenes={ordenes} responsables={responsables} />
      )}
    </div>
  )
}

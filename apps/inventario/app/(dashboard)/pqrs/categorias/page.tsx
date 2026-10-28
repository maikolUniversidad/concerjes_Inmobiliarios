// Catálogo de categorías de PQRS: lo que ve un residente al escanear la placa
// de un punto (F5 de Puntos QR).
//
// Vive dentro de /pqrs y NO en el menú lateral: es la parametrización de un
// módulo que ya está en el menú, igual que los plazos. Se entra desde el
// listado de PQRS, con la clave `parametrizar_pqrs`.

import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Tags } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { SELECT_PQRS_CATEGORIAS, type CategoriaPqrs } from '@/lib/pqrs'
import { ListaCategorias, type ContratoBreve } from './ListaCategorias'

export const metadata: Metadata = { title: 'Categorías de PQRS' }
export const dynamic = 'force-dynamic'

export default async function CategoriasPqrsPage() {
  await requirePermiso('parametrizar_pqrs', '/pqrs')
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // El catálogo es pequeño por naturaleza (seis generales más lo que agregue
  // cada contrato): cabe en una consulta, con orden estable.
  const [{ data: categorias }, { data: contratos }] = await Promise.all([
    sb.from('pqrs_categorias').select(SELECT_PQRS_CATEGORIAS)
      .order('grupo_id', { nullsFirst: true }).order('orden').order('nombre').order('id').limit(500),
    sb.from('grupos_contrato').select('id, codigo, nombre').eq('activo', true).order('codigo').limit(500),
  ])

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <Link href="/pqrs" className="font-body inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="h-4 w-4" /> PQRS
      </Link>
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Tags className="h-6 w-6 text-brand-green" /> Categorías de PQRS
        </h1>
        <p className="font-body mt-0.5 text-sm text-gray-500">
          Es la lista que ve un residente cuando escanea el QR de un punto de control. Una categoría
          sin contrato aplica a todos; si un contrato crea una con el mismo código, la reemplaza solo
          para él.
        </p>
      </div>
      <ListaCategorias
        categorias={(categorias ?? []).map((c: CategoriaPqrs) => ({ ...c, orden: Number(c.orden) }))}
        contratos={(contratos ?? []) as ContratoBreve[]}
      />
    </div>
  )
}

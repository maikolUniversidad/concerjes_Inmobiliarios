import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import type { InventarioFisico, ItemFisico } from '@/lib/inventario-fisico'
import {
  conteoDeArqueo, conteoDeCargue, lineaDeTiempo,
  type ArqueoFila, type ArqueoItemFila, type Conteo,
} from '@/lib/arqueo-analisis'
import { ArqueoTabs } from '../ArqueoTabs'
import { AnalisisClient } from './AnalisisClient'

export const metadata: Metadata = { title: 'Arqueo · Análisis entre meses' }
export const revalidate = 0

interface RawArqueoItem {
  arqueo_id: string
  producto_id: string
  cantidad_sistema: number | string
  cantidad_fisica: number | string | null
  estado: 'PENDIENTE' | 'CONTADO' | 'AJUSTADO'
  precio_lista: number | string | null
  producto: { codigo: number | null; nombre_estandar: string; presentacion: string | null } | null
}

// numeric llega como string desde PostgREST
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

export default async function ArqueoAnalisisPage() {
  const permisos = await requirePermiso('ver_arqueo')
  const verCargues = permisos.puede('ver_inventario_fisico') || permisos.puede('cargar_inventario_fisico')
  const supabase = await createClient()

  let conteos: Conteo[] = []
  try {
    const arqueos = await traerTodo<ArqueoFila>((desde, hasta) => supabase
      .from('arqueos')
      .select('id, nombre, estado, total_items, created_at, cerrado_at')
      .order('created_at').order('id')
      .range(desde, hasta) as never, { etiqueta: 'Arqueos' })

    // Solo los ítems ya contados: los pendientes no aportan al análisis
    const rawItems = await traerTodo<RawArqueoItem>((desde, hasta) => supabase
      .from('arqueo_items')
      .select('arqueo_id, producto_id, cantidad_sistema, cantidad_fisica, estado, precio_lista, producto:productos ( codigo, nombre_estandar, presentacion )')
      .neq('estado', 'PENDIENTE')
      .order('id')
      .range(desde, hasta) as never, { etiqueta: 'Ítems de arqueo' })

    const itemsArqueo: ArqueoItemFila[] = rawItems.map(i => ({
      arqueo_id: i.arqueo_id,
      producto_id: i.producto_id,
      cantidad_sistema: Number(i.cantidad_sistema),
      cantidad_fisica: n(i.cantidad_fisica),
      estado: i.estado,
      precio_lista: n(i.precio_lista),
      codigo: i.producto?.codigo ?? null,
      nombre: i.producto?.nombre_estandar ?? '—',
      presentacion: i.producto?.presentacion ?? null,
    }))
    conteos = arqueos.map(a => conteoDeArqueo({ ...a, total_items: Number(a.total_items) }, itemsArqueo))

    if (verCargues) {
      const invs = await traerTodo<InventarioFisico>((desde, hasta) => supabase
        .from('inventarios_fisicos' as never)
        .select('id, periodo, fecha_corte, archivo_nombre, observacion, historico, total_items, items_con_cantidad, items_en_cero, total_unidades, items_nuevos, items_ajustados, items_no_hallados, created_at')
        .order('fecha_corte').order('id')
        .range(desde, hasta) as never, { etiqueta: 'Cargues masivos' })
      const itemsFisicos = await traerTodo<ItemFisico>((desde, hasta) => supabase
        .from('inventario_fisico_items' as never)
        .select('inventario_id, producto_id, codigo, nombre, presentacion, estado, cantidad_contada, stock_sistema, diferencia, precio_unitario, producto_nuevo')
        // CONTADO y SIN_CANTIDAD (vino con la celda vacía: no es 0); los NO_HALLADO no vinieron
        .neq('estado', 'NO_HALLADO')
        .order('id')
        .range(desde, hasta) as never, { etiqueta: 'Ítems de cargues' })
      const limpios = itemsFisicos.map(i => ({
        ...i,
        cantidad_contada: n(i.cantidad_contada),
        stock_sistema: n(i.stock_sistema),
        diferencia: n(i.diferencia),
        precio_unitario: n(i.precio_unitario),
      }))
      conteos.push(...invs.map(inv => conteoDeCargue(inv, limpios)))
    }
  } catch (e) {
    return (
      <div className="p-4 sm:p-6 space-y-5">
        <ArqueoTabs activa="analisis" />
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 font-body text-sm">
          Error cargando los conteos: {e instanceof Error ? e.message : String(e)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <ArqueoTabs activa="analisis" />
      <AnalisisClient conteos={lineaDeTiempo(conteos)} sinCargues={!verCargues} />
    </div>
  )
}

import type { Metadata } from 'next'
import { Route } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { getPermisosUsuario, requirePermiso } from '@/lib/permisos-server'
import { RutasClient, type RutaFila, type ParadaFila, type PuntoOpcion } from './RutasClient'

export const metadata: Metadata = { title: 'Rutas de ronda' }
export const dynamic = 'force-dynamic'

/**
 * Rutas de ronda (F8): qué puntos se recorren, en qué orden y quién los hace.
 * Es lo que el mapa dibuja como línea a trazos y lo que F10 consulta para
 * contestar «¿cuál es tu próxima parada?».
 */
export default async function RutasRondaPage() {
  await requirePermiso('ver_rutas_ronda')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [rutas, paradas, contratos, sedes, puntos] = await Promise.all([
    traerTodo<RutaFila>((desde, hasta) => sb.from('ronda_rutas')
      .select(`id, codigo, grupo_id, sede_id, nombre, fecha, persona_id, turno_id, estado,
               hora_inicio, iniciado_at, finalizado_at, observacion, activo,
               contrato:grupos_contrato ( codigo, nombre ),
               sede:sedes ( nombre ),
               persona:personas ( nombres, apellidos )`)
      .order('fecha', { ascending: false }).order('codigo', { ascending: false }).order('id')
      .range(desde, hasta), { etiqueta: 'rutas de ronda' }),
    traerTodo<ParadaFila>((desde, hasta) => sb.from('ronda_ruta_paradas')
      .select(`id, ruta_id, punto_id, numero_parada, hora_estimada, tolerancia_min, estado,
               llegado_at, visita_id, observacion,
               punto:ronda_puntos ( codigo, nombre, piso )`)
      .order('ruta_id').order('numero_parada').range(desde, hasta), { etiqueta: 'paradas' }),
    traerTodo<{ id: string; codigo: string; nombre: string }>((desde, hasta) =>
      sb.from('grupos_contrato').select('id, codigo, nombre')
        .order('codigo').order('id').range(desde, hasta), { etiqueta: 'contratos' }),
    traerTodo<{ id: string; nombre: string; grupo_id: string | null }>((desde, hasta) =>
      sb.from('sedes').select('id, nombre, grupo_id')
        .order('nombre').order('id').range(desde, hasta), { etiqueta: 'sedes' }),
    traerTodo<PuntoOpcion>((desde, hasta) => sb.from('ronda_puntos')
      .select('id, codigo, nombre, sede_id, grupo_id, piso')
      .neq('estado', 'RETIRADO')
      .order('sede_id').order('orden').order('codigo').range(desde, hasta),
      { etiqueta: 'puntos de control' }),
  ])

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-bold text-gray-900">
          <Route className="h-6 w-6 text-brand-green" /> Rutas de ronda
        </h1>
        <p className="font-body mt-0.5 text-sm text-gray-500">
          {rutas.length} {rutas.length === 1 ? 'ruta' : 'rutas'} · qué puntos se recorren, en qué
          orden y a qué hora. El orden de las paradas es el que ve la persona en su celular y el
          que decide cuál es su próxima parada.
        </p>
      </div>

      <RutasClient
        rutas={rutas}
        paradas={paradas}
        contratos={contratos}
        sedes={sedes}
        puntos={puntos}
        puedeGestionar={permisos.puede('gestionar_rutas_ronda')}
      />
    </div>
  )
}

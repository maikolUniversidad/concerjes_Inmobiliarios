import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { PlantaClient, type PlantaRow, type Filtros } from './PlantaClient'

export const metadata: Metadata = { title: 'Planta de personal · Gestión Humana' }
export const dynamic = 'force-dynamic'

/**
 * Planta de personal: el maestro completo que viene de nómina (activos +
 * retirados, más de seis mil fichas). Por eso el filtrado y la paginación son
 * del SERVIDOR: traer todo al navegador sería varios megas por carga, y
 * PostgREST corta en 1.000 filas sin avisar.
 */
export const TAMANO_PAGINA = 50

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export default async function PlantaPage({ searchParams }: Props) {
  await requirePermiso('ver_planta_personal')
  const sp = await searchParams
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any

  const filtros: Filtros = {
    q: uno(sp.q).trim(),
    estado: uno(sp.estado) || 'ACTIVO',
    ciudad: uno(sp.ciudad),
    centro: uno(sp.centro),
    // 'disponible' = en planta pero sin contrato al que esté amarrado.
    vista: uno(sp.vista),
    pagina: Math.max(1, Number(uno(sp.pagina) || 1) || 1),
  }

  const desde = (filtros.pagina - 1) * TAMANO_PAGINA

  let consulta = sb
    .from('vw_planta_personal')
    .select(
      'id, documento, nombre_completo, nombres, apellidos, cargo, estado, ciudad, departamento, ' +
      'centro_costo, es_disponibilidad, telefono, salario, fecha_ingreso, fecha_retiro, ' +
      'tiene_cuenta, usuario_email, usuario_rol, veces_vinculado, tiene_vinculacion_activa, ' +
      'candidato_id, nombre_confianza',
      { count: 'exact' },
    )

  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado)
  if (filtros.ciudad) consulta = consulta.eq('ciudad', filtros.ciudad)
  if (filtros.centro) consulta = consulta.eq('centro_costo', filtros.centro)
  if (filtros.vista === 'disponibles') {
    consulta = consulta.eq('estado', 'ACTIVO').eq('tiene_vinculacion_activa', true).eq('es_disponibilidad', true)
  }
  if (filtros.vista === 'sin_cuenta') consulta = consulta.eq('tiene_cuenta', false)
  if (filtros.vista === 'revisar') consulta = consulta.in('nombre_confianza', ['BAJA', 'MEDIA'])
  if (filtros.q) {
    const t = filtros.q.replace(/[%,()]/g, ' ')
    consulta = consulta.or(`documento.ilike.%${t}%,nombre_completo.ilike.%${t}%,cargo.ilike.%${t}%`)
  }

  const [
    { data: filas, count },
    { data: resumen },
    { data: centros },
    { data: ciudades },
    { data: incidencias },
  ] = await Promise.all([
    consulta
      .order('apellidos', { ascending: true })
      .order('documento', { ascending: true })
      .range(desde, desde + TAMANO_PAGINA - 1),
    sb.rpc('planta_resumen'),
    sb.from('centros_costo').select('codigo, ciudad, es_disponibilidad').order('codigo'),
    sb.from('personas').select('ciudad').not('ciudad', 'is', null),
    sb.from('vw_planta_inconsistencias').select('motivo'),
  ])

  // Las ciudades salen de las fichas: no hay catálogo y la nómina escribe
  // ciudades que no siempre están en el DANE (p. ej. «SAN ANDRES PROVIDENCIA»).
  const listaCiudades = [...new Set((ciudades ?? []).map((c: { ciudad: string }) => c.ciudad))].sort() as string[]

  const porMotivo = (incidencias ?? []).reduce((a: Record<string, number>, i: { motivo: string }) => {
    a[i.motivo] = (a[i.motivo] ?? 0) + 1
    return a
  }, {})

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Planta de personal</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Maestro de colaboradores desde nómina · activos, retirados e historial de vinculaciones
        </p>
      </div>

      <PlantaClient
        filas={(filas ?? []) as PlantaRow[]}
        total={count ?? 0}
        tamanoPagina={TAMANO_PAGINA}
        filtros={filtros}
        resumen={(resumen?.[0] ?? null) as Record<string, number> | null}
        centros={(centros ?? []) as { codigo: string; ciudad: string | null; es_disponibilidad: boolean }[]}
        ciudades={listaCiudades}
        incidencias={porMotivo}
      />
    </div>
  )
}

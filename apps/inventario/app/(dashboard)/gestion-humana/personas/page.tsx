import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { PersonasClient, type PersonaRow, type FiltrosPersonas } from './PersonasClient'

export const metadata: Metadata = { title: 'Personas · Gestión Humana' }
export const dynamic = 'force-dynamic'

/**
 * Con el cargue de nómina el maestro pasó de 79 a 6.564 fichas, así que la
 * búsqueda y la paginación son del SERVIDOR. Antes la pantalla pedía todas las
 * personas de una y filtraba en memoria: PostgREST corta TODA respuesta en
 * 1.000 filas sin error y sin aviso, así que la pantalla mostraba «1000 de 1000»
 * y las otras 5.564 personas simplemente no existían para el usuario.
 */
export const TAMANO_PAGINA = 60

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export default async function PersonasPage({ searchParams }: Props) {
  await requirePermiso('ver_personas')
  const sp = await searchParams
  const supabase = await createClient()

  const filtros: FiltrosPersonas = {
    q: uno(sp.q).trim(),
    estado: uno(sp.estado),
    vista: uno(sp.vista) === 'tarjetas' ? 'tarjetas' : 'tabla',
    pagina: Math.max(1, Number(uno(sp.pagina) || 1) || 1),
  }
  const desde = (filtros.pagina - 1) * TAMANO_PAGINA

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consulta = (supabase as any)
    .from('personas')
    .select(`
      id, tipo_doc, documento, nombres, apellidos, nombre_completo, cargo,
      empresa_usuaria_id, sede_id, fecha_ingreso, fecha_retiro, estado, email,
      telefono, direccion, eps, arl, usuario_id, created_at, ciudad, origen,
      empresas_usuarias ( id, nombre ),
      sedes ( id, nombre ),
      centros_costo ( id, codigo ),
      cuenta:usuarios ( id, email, activo, rol_id, roles ( id, nombre ) )
    `, { count: 'exact' })

  if (filtros.estado) consulta = consulta.eq('estado', filtros.estado)
  if (filtros.q) {
    // Se limpian los caracteres que PostgREST usa para separar el `or`.
    const t = filtros.q.replace(/[%,()]/g, ' ')
    consulta = consulta.or(
      `documento.ilike.%${t}%,nombres.ilike.%${t}%,apellidos.ilike.%${t}%,` +
      `nombre_completo.ilike.%${t}%,cargo.ilike.%${t}%`,
    )
  }

  const [
    { data: personas, count },
    { data: empresas },
    sedes,
    { data: roles },
    documentos,
  ] = await Promise.all([
    consulta
      .order('apellidos', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, desde + TAMANO_PAGINA - 1),
    supabase.from('empresas_usuarias').select('*').order('nombre'),
    traerTodo<{ id: string; nombre: string }>((d, h) => supabase
      .from('sedes').select('id, nombre').order('nombre').order('id').range(d, h)),
    supabase.from('roles').select('id, nombre, descripcion, permisos').eq('activo', true).order('nombre'),
    // El cargue masivo necesita TODOS los documentos, no solo los de esta
    // página: si no, intentaría crear de nuevo a alguien que ya existe y
    // chocaría con el índice único.
    traerTodo<{ documento: string }>((d, h) => supabase
      .from('personas').select('documento').order('documento').range(d, h),
      { etiqueta: 'documentos de personas' }),
  ])

  const existentes = documentos.map((p) => `documento:${String(p.documento).trim().toLowerCase()}`)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Personas</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Colaboradores y su empresa usuaria asignada · {(count ?? 0).toLocaleString('es-CO')} fichas
        </p>
      </div>

      <PersonasClient
        personas={(personas ?? []) as PersonaRow[]}
        total={count ?? 0}
        tamanoPagina={TAMANO_PAGINA}
        filtros={filtros}
        empresas={empresas ?? []}
        sedes={sedes}
        roles={roles ?? []}
        existentes={existentes}
      />
    </div>
  )
}

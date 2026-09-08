import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso } from '@/lib/permisos-server'
import { PersonasClient, type PersonaRow } from './PersonasClient'

export const metadata: Metadata = { title: 'Personas · Gestión Humana' }
export const dynamic = 'force-dynamic'

const SELECT = `
  id, tipo_doc, documento, nombres, apellidos, nombre_completo, nombre_confianza, cargo,
  empresa_usuaria_id, sede_id, fecha_ingreso, fecha_retiro, estado, email,
  telefono, direccion, eps, arl, usuario_id, created_at, ciudad, origen,
  empresas_usuarias ( id, nombre ),
  sedes ( id, nombre ),
  centros_costo ( id, codigo ),
  cuenta:usuarios ( id, email, activo, rol_id, roles ( id, nombre ) )
`

export default async function PersonasPage() {
  await requirePermiso('ver_personas')
  const supabase = await createClient()

  // `traerTodo` y no una sola consulta: con el cargue de nómina el maestro pasó
  // de 79 a 6.639 fichas, y PostgREST corta TODA respuesta en 1.000 filas sin
  // error y sin aviso. Antes la pantalla decía «1000 de 1000» y las otras 5.639
  // no existían para quien la usaba.
  const [personas, { data: empresas }, sedes, { data: roles }] = await Promise.all([
    traerTodo<PersonaRow>((desde, hasta) => supabase
      .from('personas')
      .select(SELECT)
      .order('apellidos', { ascending: true })
      .order('id', { ascending: true })
      .range(desde, hasta) as never,
      { etiqueta: 'personas' }),
    supabase.from('empresas_usuarias').select('*').order('nombre'),
    traerTodo<{ id: string; nombre: string }>((desde, hasta) => supabase
      .from('sedes').select('id, nombre').order('nombre').order('id').range(desde, hasta)),
    supabase.from('roles').select('id, nombre, descripcion, permisos').eq('activo', true).order('nombre'),
  ])

  // Claves para el cargue masivo (formato de validarFila: `documento:<valor>`).
  const existentes = personas.map((p) => `documento:${String(p.documento).trim().toLowerCase()}`)

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Personas</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Colaboradores y su empresa usuaria asignada · {personas.length.toLocaleString('es-CO')} fichas
        </p>
      </div>

      <PersonasClient
        personas={personas}
        empresas={empresas ?? []}
        sedes={sedes}
        roles={roles ?? []}
        existentes={existentes}
      />
    </div>
  )
}

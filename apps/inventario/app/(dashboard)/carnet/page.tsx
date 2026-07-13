import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ROL_LABELS, type RolUsuario } from '@/lib/types/database'
import { CarnetClient, type CarnetData } from './CarnetClient'

export const metadata: Metadata = { title: 'Mi Carnet Digital' }
export const dynamic = 'force-dynamic'

// Datos de la organización (mismos que Configuración → Organización).
const ORG = {
  nombre: 'Conserjes Inmobiliarios',
  razon: 'Conserjes Inmobiliarios Ltda',
  nit: '800093388-2',
  web: 'conserjesinmobiliarios.com',
}

export default async function CarnetPage() {
  // El carnet es personal: cualquier usuario autenticado puede ver el suyo.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: u } = await supabase
    .from('usuarios')
    .select(`
      id, nombre, email, rol, telefono, avatar_url, created_at,
      sedes ( nombre ),
      grupos_contrato ( codigo, nombre ),
      roles ( nombre )
    `)
    .eq('id', user.id)
    .single()

  // Persona vinculada (Gestión Humana) → documento, cargo, empresa, estado.
  const { data: persona } = await supabase
    .from('personas')
    .select(`
      tipo_doc, documento, cargo, fecha_ingreso, estado, eps, arl,
      empresas_usuarias ( nombre ),
      sedes ( nombre )
    `)
    .eq('usuario_id', user.id)
    .maybeSingle()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usr = (u ?? {}) as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const per = (persona ?? null) as any

  const rolNombre: string =
    usr.roles?.nombre ??
    (ROL_LABELS[usr.rol as RolUsuario]?.label) ??
    usr.rol ??
    'Colaborador'

  const data: CarnetData = {
    id: user.id,
    nombre: usr.nombre ?? user.email ?? 'Colaborador',
    email: usr.email ?? user.email ?? '',
    rol: rolNombre,
    telefono: usr.telefono ?? null,
    avatar_url: usr.avatar_url ?? null,
    tipo_doc: per?.tipo_doc ?? null,
    documento: per?.documento ?? null,
    cargo: per?.cargo ?? null,
    empresa: per?.empresas_usuarias?.nombre ?? null,
    sede: per?.sedes?.nombre ?? usr.sedes?.nombre ?? null,
    grupo: usr.grupos_contrato?.nombre ?? null,
    eps: per?.eps ?? null,
    arl: per?.arl ?? null,
    estado: per?.estado ?? 'ACTIVO',
    fecha_ingreso: per?.fecha_ingreso ?? null,
    creado: usr.created_at ?? null,
    org: ORG,
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Mi Carnet Digital</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Tu credencial de identificación. Muéstrala desde el celular o descárgala.
        </p>
      </div>

      <CarnetClient data={data} />
    </div>
  )
}

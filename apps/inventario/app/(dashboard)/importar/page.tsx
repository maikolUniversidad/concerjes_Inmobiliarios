import type { Metadata } from 'next'
import { UploadCloud } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { normalizaClave } from '@/lib/import/config'
import { ImportarClient, type HistorialCarga } from './ImportarClient'

export const metadata: Metadata = { title: 'Cargas masivas' }
export const revalidate = 0

function tok(mk: string, v: unknown): string | null {
  if (v === null || v === undefined || String(v).trim() === '') return null
  return `${mk}:${normalizaClave(v)}`
}

export default async function ImportarPage() {
  await requirePermiso('importar_datos')
  const supabase = await createClient()

  const [prod, prov, usu, emp, sed, hist] = await Promise.all([
    supabase.from('productos').select('ref, codigo, nombre_estandar'),
    supabase.from('proveedores').select('nit, nombre'),
    supabase.from('usuarios').select('email'),
    supabase.from('empresas_usuarias').select('nombre, nit'),
    supabase.from('sedes').select('codigo_interno, nombre'),
    supabase.from('importaciones').select('id, entidad, archivo_nombre, total, creados, actualizados, errores, usuario_email, created_at').order('created_at', { ascending: false }).limit(20),
  ])

  const productos = ((prod.data as { ref: number | null; codigo: number | null; nombre_estandar: string }[]) ?? [])
    .flatMap(p => [tok('ref', p.ref), tok('codigo', p.codigo), tok('nombre_estandar', p.nombre_estandar)])
    .filter((x): x is string => x !== null)

  const proveedores = ((prov.data as { nit: string | null; nombre: string }[]) ?? [])
    .flatMap(p => [tok('nit', p.nit), tok('nombre', p.nombre)])
    .filter((x): x is string => x !== null)

  const usuarios = ((usu.data as { email: string }[]) ?? [])
    .map(u => tok('email', u.email))
    .filter((x): x is string => x !== null)

  const empresas_usuarias = ((emp.data as { nombre: string; nit: string | null }[]) ?? [])
    .flatMap(e => [tok('nombre', e.nombre), tok('nit', e.nit)])
    .filter((x): x is string => x !== null)

  const sedes = ((sed.data as { codigo_interno: string | null; nombre: string }[]) ?? [])
    .flatMap(s => [tok('codigo_interno', s.codigo_interno), tok('nombre', s.nombre)])
    .filter((x): x is string => x !== null)

  const historial = (hist.data as unknown as HistorialCarga[]) ?? []

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <UploadCloud className="w-6 h-6 text-brand-green" /> Cargas masivas
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Importa productos, proveedores, usuarios, clientes o sedes desde Excel/CSV. Si ya existen, se actualizan en lugar de duplicarse.
          Todo queda registrado en el historial y versionado.
        </p>
      </div>

      <ImportarClient existentes={{ productos, proveedores, usuarios, empresas_usuarias, sedes }} historial={historial} />
    </div>
  )
}

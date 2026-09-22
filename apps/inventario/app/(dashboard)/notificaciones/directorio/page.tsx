import type { Metadata } from 'next'
import Link from 'next/link'
import { BookUser, ChevronLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import type { CentroMedico, DirectorioContacto, DirectorioLista } from '@/lib/types/database'
import { DirectorioClient, type OtraFuente, type UsoDestino } from './DirectorioClient'

export const metadata: Metadata = { title: 'Directorio de correos' }
export const revalidate = 0

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function DirectorioPage() {
  const permisos = await requirePermiso('ver_directorio_correos')
  const supabase = (await createClient()) as any

  const conteo = (q: any) => q.then((r: any) => (r.error ? null : (r.count ?? 0)))
  const [ips, listas, contactos, empresa, usos, cuenta, eu, ee, usuarios, proveedores, proveedoresConCorreo, clientes, clientesConCorreo] =
    await Promise.all([
      supabase.from('ips').select('*').order('orden').order('nombre'),
      supabase.from('directorio_listas').select('*').order('orden').order('nombre'),
      supabase.from('directorio_contactos').select('*').order('orden').order('nombre'),
      supabase.from('vac_empresa').select('razon_social, nit, correo_seleccion, correo_datos, telefono, telefono_nomina, contacto_nomina').eq('id', 1).maybeSingle(),
      supabase.rpc('directorio_usos'),
      supabase.rpc('correo_envio_configurado'),
      supabase.from('empresas_usuarias').select('id, nombre, email, activo').order('nombre'),
      supabase.from('empresas_emisoras').select('id, razon_social, email, activo').order('razon_social'),
      conteo(supabase.from('usuarios').select('id', { count: 'exact', head: true }).eq('activo', true)),
      conteo(supabase.from('proveedores').select('id', { count: 'exact', head: true })),
      conteo(supabase.from('proveedores').select('id', { count: 'exact', head: true }).not('email', 'is', null).neq('email', '')),
      conteo(supabase.from('clientes').select('id', { count: 'exact', head: true })),
      conteo(supabase.from('clientes').select('id', { count: 'exact', head: true }).not('email', 'is', null).neq('email', '')),
    ])

  // Otros correos que ya tiene la plataforma: se editan en su propio módulo.
  const otras: OtraFuente[] = [
    { nombre: 'Usuarios de la plataforma', detalle: 'Reciben avisos por rol o por persona en los flujos.', total: usuarios, conCorreo: usuarios, href: '/usuarios' },
    { nombre: 'Proveedores', detalle: 'Correo de contacto de cada proveedor.', total: proveedores, conCorreo: proveedoresConCorreo, href: '/proveedores' },
    { nombre: 'Clientes del portal de servicios del hogar', detalle: 'Reciben los avisos de sus solicitudes y pagos.', total: clientes, conCorreo: clientesConCorreo, href: '/servicios-hogar' },
    ...((eu.data ?? []) as any[]).map((e) => ({
      nombre: `Empresa usuaria · ${e.nombre}`, detalle: e.email ?? 'Sin correo', total: 1, conCorreo: e.email ? 1 : 0, href: '/gestion-humana/personas',
    })),
    ...((ee.data ?? []) as any[]).map((e) => ({
      nombre: `Empresa emisora · ${e.razon_social}`, detalle: e.email ?? 'Sin correo', total: 1, conCorreo: e.email ? 1 : 0, href: '/configuracion/empresas',
    })),
  ]

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-6xl">
      <div>
        <Link href="/notificaciones" className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-gray-600 mb-2">
          <ChevronLeft className="w-3.5 h-3.5" /> Notificaciones
        </Link>
        <h1 className="font-heading font-bold text-2xl text-gray-900 flex items-center gap-2">
          <BookUser className="w-6 h-6 text-brand-green" /> Directorio de correos
        </h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          A quién le escribe la plataforma: los centros médicos de la remisión a exámenes, las listas internas (Selección,
          Nómina…) y los correos de la empresa. Los flujos de notificación toman los correos de aquí al momento de enviar.
        </p>
      </div>

      <DirectorioClient
        centros={(ips.data ?? []) as CentroMedico[]}
        listas={(listas.data ?? []) as DirectorioLista[]}
        contactos={(contactos.data ?? []) as DirectorioContacto[]}
        empresa={empresa.data ?? null}
        usos={(usos.data ?? []) as UsoDestino[]}
        cuentaConectada={cuenta.data === true}
        otras={otras}
        puedeGestionar={permisos.puede('gestionar_directorio_correos')}
        puedeEditarCentros={permisos.puede('gestionar_directorio_correos') || permisos.puede('gestionar_postulaciones')}
        puedeVerIntegraciones={permisos.puede('gestionar_integraciones')}
      />
    </div>
  )
}

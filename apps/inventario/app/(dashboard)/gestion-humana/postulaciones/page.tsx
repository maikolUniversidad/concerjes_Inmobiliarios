import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { requirePermiso } from '@/lib/permisos-server'
import { traerTodo } from '@/lib/supabase/paginado'
import { PostulacionesClient } from './PostulacionesClient'
import type { Catalogos, FilaBandeja } from './tipos'

export const metadata: Metadata = { title: 'Postulaciones · Gestión Humana' }
export const dynamic = 'force-dynamic'

export default async function PostulacionesPage() {
  await requirePermiso('ver_postulaciones')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = (await createClient()) as any

  const [
    filas,
    { data: cargos }, { data: centros }, { data: requisiciones }, { data: ips }, { data: motivos },
    { data: tipos }, { data: roles }, { data: arl }, { data: plantillas }, { data: params },
  ] = await Promise.all([
    // Paginado: PostgREST corta en 1.000 filas sin avisar.
    traerTodo<FilaBandeja>((desde, hasta) => sb.from('vw_ats_bandeja').select('*')
      .order('updated_at', { ascending: false }).order('id').range(desde, hasta), { etiqueta: 'bandeja de postulaciones' }),
    sb.from('cargos').select('id, nombre, requiere_manipulacion_alimentos, requiere_trabajo_alturas, requiere_libreta_militar, requiere_curso_grecas').eq('activo', true).order('nombre'),
    sb.from('centros_costo').select('id, codigo, nombre, ciudad').eq('activo', true).order('codigo'),
    sb.from('requisiciones').select('id, numero, cliente_nombre, cargo_texto, cantidad, cupos_cubiertos, estado').in('estado', ['ABIERTA', 'EN_PROCESO']).order('created_at', { ascending: false }),
    sb.from('ips').select('id, nombre, correo, correos_copia, telefono, direccion, ciudad, notas').eq('activo', true).order('orden'),
    sb.from('vac_listas_opciones').select('valor, etiqueta').eq('lista', 'MOTIVO_DESCARTE').eq('activo', true).order('orden'),
    sb.from('vac_tipos_documentales').select('*').order('ola').order('orden'),
    sb.from('roles').select('id, nombre, rol_base').eq('activo', true).order('nombre'),
    sb.from('arl').select('id, nombre').eq('activo', true).order('nombre'),
    sb.from('plantillas_documento').select('id, codigo, nombre, momento, orden, obligatoria, requiere_contrato, requiere_firma_trabajador, visible_candidato, permite_firma_electronica, version_vigente, descripcion').eq('activa', true).neq('momento', 'INTERNO').order('orden'),
    sb.from('parametros_legales').select('anio, smlv').order('anio', { ascending: false }),
  ])

  const anio = new Date().getFullYear()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const smlv = ((params ?? []) as any[]).find((p) => p.anio <= anio)?.smlv ?? null

  const catalogos: Catalogos = {
    cargos: cargos ?? [], centros: centros ?? [], requisiciones: requisiciones ?? [], ips: ips ?? [],
    motivos: motivos ?? [], tipos: tipos ?? [], roles: roles ?? [], arl: arl ?? [], plantillas: plantillas ?? [],
    smlv: smlv ? Number(smlv) : null,
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="font-heading font-bold text-2xl text-gray-900">Selección y contratación</h1>
        <p className="font-body text-sm text-gray-500 mt-0.5">
          Candidatos del registro de vacantes, del formulario a la firma del contrato y la entrega a nómina
        </p>
      </div>
      <PostulacionesClient filas={filas} catalogos={catalogos} />
    </div>
  )
}

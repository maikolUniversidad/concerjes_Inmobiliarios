import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getPermisosUsuario } from '@/lib/permisos-server'
import { UUID_RE } from '@/lib/mantenimiento'
import { EquipoCampoClient, type EquipoFicha, type TicketResumen, type ActividadRow, type EventoRow } from './EquipoCampoClient'

export const metadata: Metadata = { title: 'Equipo' }
export const dynamic = 'force-dynamic'

const SELECT_MAQ = 'id, codigo, nombre, tipo, marca, modelo, serial, estado, condicion, ubicacion_sede_id, ubicacion_texto, responsable, imagen_url, fecha_adquisicion, observaciones, activo, frecuencia_mant_dias, ultimo_mant_at, proximo_mant, sedes:ubicacion_sede_id(id, nombre)'

export default async function EquipoCampoPage({ params }: { params: Promise<{ ref: string }> }) {
  const perm = await getPermisosUsuario()
  const puedeReportar = perm.puede('reportar_falla_maquinaria')
  const verMant = perm.puede('ver_mantenimiento')
  if (!puedeReportar && !verMant && !perm.puede('ver_maquinaria')) redirect('/dashboard')

  const { ref: refCruda } = await params
  const ref = decodeURIComponent(refCruda).trim()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // El QR trae el código (o el id, en etiquetas viejas); el usuario puede digitarlo en minúsculas.
  let maquina: EquipoFicha | null = null
  if (UUID_RE.test(ref)) {
    maquina = (await sb.from('maquinaria').select(SELECT_MAQ).eq('id', ref).maybeSingle()).data
  }
  if (!maquina) {
    const literal = ref.replace(/[%_\\]/g, (m) => '\\' + m)
    maquina = (await sb.from('maquinaria').select(SELECT_MAQ).ilike('codigo', literal).limit(1).maybeSingle()).data
  }
  if (!maquina) notFound()

  const participa = puedeReportar || verMant || perm.puede('atender_mantenimiento') || perm.puede('gestionar_mantenimiento')
  const [tickets, actividades, eventos] = await Promise.all([
    participa
      ? sb.from('mantenimiento_tickets')
          .select('id, numero, tipo, prioridad, estado, titulo, reportado_nombre, created_at, resuelto_at, programado_para, ultimo_mensaje_at, asignado_nombre')
          .eq('maquinaria_id', maquina.id).order('created_at', { ascending: false }).limit(50)
          .then((r: { data: unknown }) => r.data)
      : Promise.resolve([]),
    sb.from('mantenimiento_actividades')
      .select('id, tipo, resultado, descripcion, checklist, condicion, fotos, usuario_nombre, created_at, ticket_id')
      .eq('maquinaria_id', maquina.id).order('created_at', { ascending: false }).limit(20)
      .then((r: { data: unknown }) => r.data),
    sb.from('maquinaria_eventos')
      .select('id, tipo, descripcion, usuario_nombre, usuario_email, created_at, ticket_id')
      .eq('maquinaria_id', maquina.id).order('created_at', { ascending: false }).limit(60)
      .then((r: { data: unknown }) => r.data),
  ])

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-4">
      <Link href="/equipo" className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 font-body text-sm">
        <ArrowLeft className="w-4 h-4" /> Escanear otro equipo
      </Link>
      <EquipoCampoClient
        maquina={maquina}
        tickets={(tickets ?? []) as TicketResumen[]}
        actividades={(actividades ?? []) as ActividadRow[]}
        eventos={(eventos ?? []) as EventoRow[]}
        permisos={{
          reportar: puedeReportar || perm.puede('atender_mantenimiento') || perm.puede('gestionar_mantenimiento'),
          tecnico: perm.puede('atender_mantenimiento') || perm.puede('gestionar_mantenimiento'),
          verHojaVida: perm.puede('ver_maquinaria'),
          verTickets: participa,
        }}
      />
    </div>
  )
}

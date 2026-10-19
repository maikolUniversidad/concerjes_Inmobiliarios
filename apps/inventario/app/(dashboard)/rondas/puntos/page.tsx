import type { Metadata } from 'next'
import { MapPin } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso, getPermisosUsuario } from '@/lib/permisos-server'
import type { EstadoPunto, EstadoQr } from '@/lib/puntos-qr'
import { PuntosClient, type PuntoFila, type SedeOpcion, type ZonaFila } from './PuntosClient'

export const metadata: Metadata = { title: 'Zonas y puntos de control' }
export const dynamic = 'force-dynamic'

interface SedeRaw {
  id: string; nombre: string; ciudad: string | null; grupo_id: string
  grupo: { codigo: string; nombre: string; estado: string | null } | null
}
interface ZonaRaw {
  id: string; sede_id: string; codigo: string; nombre: string
  piso: string | null; orden: number; activo: boolean
}
interface PuntoRaw {
  id: string; sede_id: string; zona_id: string | null; codigo: string; nombre: string
  descripcion: string | null; piso: string | null; lat: string | null; lng: string | null
  precision_metros: string | null; geocerca_metros: number; exige_geocerca: boolean
  horario_dias: number[] | null; horario_desde: string | null; horario_hasta: string | null
  orden: number; estado: EstadoPunto; sede_nombre: string | null
  ronda_qr: { id: string; estado: EstadoQr; version: number; codigo_manual: string }[] | null
}

export default async function PuntosPage() {
  await requirePermiso('ver_puntos_ronda')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  // La RLS decide el alcance: cada quien ve los puntos de los contratos a los
  // que alcanza (auth_grupos()); un ADMIN ve todos. Aquí no se filtra por
  // contrato a mano — hacerlo duplicaría la regla y la dejaría desincronizada.
  const [sedesRaw, zonasRaw, puntosRaw] = await Promise.all([
    traerTodo<SedeRaw>((desde, hasta) => sb.from('sedes')
      .select('id, nombre, ciudad, grupo_id, grupo:grupos_contrato ( codigo, nombre, estado )')
      .eq('activo', true)
      .order('nombre').order('id').range(desde, hasta), { etiqueta: 'sedes' }),
    traerTodo<ZonaRaw>((desde, hasta) => sb.from('ronda_zonas')
      .select('id, sede_id, codigo, nombre, piso, orden, activo')
      .order('orden').order('nombre').order('id').range(desde, hasta), { etiqueta: 'zonas' }),
    traerTodo<PuntoRaw>((desde, hasta) => sb.from('ronda_puntos')
      .select(`id, sede_id, zona_id, codigo, nombre, descripcion, piso, lat, lng,
               precision_metros, geocerca_metros, exige_geocerca, horario_dias,
               horario_desde, horario_hasta, orden, estado, sede_nombre,
               ronda_qr ( id, estado, version, codigo_manual )`)
      // Orden estable por sede + orden + código + id: `traerTodo` pagina con
      // OFFSET, y sin un orden único las páginas repiten o pierden filas.
      .order('sede_nombre').order('orden').order('codigo').order('id')
      .range(desde, hasta), { etiqueta: 'puntos de control' }),
  ])

  const sedes: SedeOpcion[] = sedesRaw.map((s) => ({
    id: s.id,
    nombre: s.nombre,
    ciudad: s.ciudad,
    contrato: s.grupo?.codigo ?? '—',
    contratoNombre: s.grupo?.nombre ?? '',
    contratoEstado: s.grupo?.estado ?? null,
  }))

  const zonas: ZonaFila[] = zonasRaw.map((z) => ({
    id: z.id, sedeId: z.sede_id, codigo: z.codigo, nombre: z.nombre,
    piso: z.piso, orden: z.orden, activo: z.activo,
    puntos: puntosRaw.filter((p) => p.zona_id === z.id).length,
  }))

  const puntos: PuntoFila[] = puntosRaw.map((p) => {
    const activo = (p.ronda_qr ?? []).find((q) => q.estado === 'ACTIVO') ?? null
    return {
      id: p.id,
      sedeId: p.sede_id,
      sedeNombre: p.sede_nombre ?? sedes.find((s) => s.id === p.sede_id)?.nombre ?? '',
      zonaId: p.zona_id,
      zonaNombre: zonas.find((z) => z.id === p.zona_id)?.nombre ?? null,
      codigo: p.codigo,
      nombre: p.nombre,
      descripcion: p.descripcion,
      piso: p.piso,
      lat: p.lat === null ? null : Number(p.lat),
      lng: p.lng === null ? null : Number(p.lng),
      precisionMetros: p.precision_metros === null ? null : Number(p.precision_metros),
      geocercaMetros: Number(p.geocerca_metros),
      exigeGeocerca: p.exige_geocerca,
      horarioDias: p.horario_dias ?? [1, 2, 3, 4, 5, 6, 7],
      horarioDesde: p.horario_desde,
      horarioHasta: p.horario_hasta,
      orden: p.orden,
      estado: p.estado,
      qrVersiones: (p.ronda_qr ?? []).length,
      qrActivo: activo
        ? { id: activo.id, version: Number(activo.version), codigoManual: activo.codigo_manual }
        : null,
    }
  })

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-bold text-gray-900">
          <MapPin className="h-6 w-6 text-brand-green" /> Zonas y puntos de control
        </h1>
        <p className="font-body mt-0.5 text-sm text-gray-500">
          {puntos.length} puntos en {zonas.length} zonas ·{' '}
          {puntos.filter((p) => p.qrActivo).length} con código QR activo · el punto es lo que
          lleva el QR pegado a la pared, y de su ubicación y su geocerca depende que una visita
          se pueda dar por hecha
        </p>
      </div>

      <PuntosClient
        sedes={sedes}
        zonas={zonas}
        puntos={puntos}
        puedeGestionar={permisos.puede('gestionar_puntos_ronda')}
      />
    </div>
  )
}

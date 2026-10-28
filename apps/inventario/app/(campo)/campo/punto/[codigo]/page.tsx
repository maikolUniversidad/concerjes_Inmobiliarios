import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { MapPin, Building2, Layers } from 'lucide-react'
import { resolverCodigo, TEXTO_RECHAZO } from '@/app/q/decidir'
import { puertaSupabase } from '@/app/q/puerta-supabase'
import { actorDeCampo } from '@/lib/campo/sesion'
import { getAdmin } from '@/lib/supabase/admin'
import { TareasDelPunto, type TareaPwa } from '@/components/campo/TareasDelPunto'

// El punto, con las tareas que aplican a esta hora y este día.
//
// ES LA CONTINUACIÓN DEL PUNTO DE BIFURCACIÓN que dejó F2 en
// `apps/inventario/app/q/decidir.ts`: la resolución del código —forma, firma,
// estado del QR, vigencia del contrato, estado del punto, y el evento de
// auditoría de cada rechazo— es la MISMA función que usa la página pública. No
// se reimplementa aquí: si la firma del QR cambia, cambia en un solo sitio.
//
// Lo que esta pantalla agrega es la sesión: quién llegó, y qué puede hacer.
export const dynamic = 'force-dynamic'

async function ip(): Promise<string | null> {
  const h = await headers()
  const directa = h.get('x-real-ip')
  if (directa && /^[0-9a-fA-F.:]+$/.test(directa.trim())) return directa.trim()
  const primera = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return primera && /^[0-9a-fA-F.:]+$/.test(primera) ? primera : null
}

export default async function PuntoCampoPage({
  params,
}: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await params
  const r = await resolverCodigo(decodeURIComponent(codigo), await ip(), puertaSupabase())

  if (!r.ok) {
    const t = TEXTO_RECHAZO[r.motivo]
    return (
      <main className="px-4 py-8">
        <div className="rounded-2xl border border-red-100 bg-white p-5 text-center">
          <h1 className="font-heading text-xl font-bold">{t.titulo}</h1>
          <p className="mt-2 text-sm text-gray-600">{t.detalle}</p>
          <a
            href="/campo"
            className="mt-5 flex h-14 w-full items-center justify-center rounded-xl bg-gray-900 font-bold text-white"
          >
            Volver a intentar
          </a>
        </div>
      </main>
    )
  }

  // F6: la placa puede ser de un ACTIVO del cliente, no de un punto de control.
  // Esta pantalla ejecuta las tareas de un PUNTO, así que de un activo no tiene
  // nada que ejecutar todavía: la orden de trabajo sobre un equipo es F7. Se
  // muestra qué se escaneó y se manda a la ficha pública, que sí la resuelve.
  if (r.objeto === 'ACTIVO') {
    return (
      <main className="px-4 py-8">
        <div className="rounded-2xl border border-gray-100 bg-white p-5 text-center">
          <h1 className="font-heading text-xl font-bold">{r.activo.nombre}</h1>
          <p className="mt-1 text-sm text-gray-500">
            {r.activo.codigo}
            {r.activo.tipo ? ` · ${r.activo.tipo}` : ''}
          </p>
          <p className="mt-3 text-sm text-gray-600">
            Esta placa es de un equipo, no de un punto de control. Reportar una falla y hacerle
            mantenimiento desde la app todavía no está disponible.
          </p>
          <a
            href={`/q/${encodeURIComponent(codigo)}`}
            className="mt-5 flex h-14 w-full items-center justify-center rounded-xl bg-gray-900 font-bold text-white"
          >
            Ver la ficha del equipo
          </a>
          <a href="/campo" className="mt-3 block text-sm font-semibold text-gray-500">
            Volver a escanear
          </a>
        </div>
      </main>
    )
  }

  // Sin identidad no se ejecuta nada, pero se conserva el destino: quien
  // escanea la placa vuelve a ESTE punto después de poner su PIN (ADR-A).
  const actor = await actorDeCampo()
  if (!actor) {
    const destino = `/campo/punto/${encodeURIComponent(codigo)}`
    redirect(`/campo/entrar?destino=${encodeURIComponent(destino)}`)
  }

  // Las tareas: la MISMA consulta para los dos tipos de identidad. Quien tiene
  // cuenta podría llamar `ronda_tareas_aplicables()` con su sesión, pero aquí
  // se renderiza en el servidor y `ronda_tareas_punto()` responde igual; el
  // alcance se comprueba abajo contra el contrato del punto.
  const sb = getAdmin()
  const { data: punto } = await sb
    .from('ronda_puntos')
    .select('id, grupo_id, geocerca_metros, exige_geocerca, lat, lng')
    .eq('id', r.punto.id)
    .maybeSingle()
  const p = punto as {
    id: string; grupo_id: string; geocerca_metros: number; exige_geocerca: boolean
    lat: number | null; lng: number | null
  } | null
  if (!p) redirect('/campo')

  if (actor.grupoId && actor.grupoId !== p.grupo_id && actor.metodo === 'ENLACE_PIN') {
    return (
      <main className="px-4 py-8">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-center">
          <h1 className="font-heading text-xl font-bold text-amber-900">
            Este punto no es de tu contrato
          </h1>
          <p className="mt-2 text-sm text-amber-800">
            Entraste con un acceso de otra sede. Pide un acceso nuevo escaneando esta placa.
          </p>
        </div>
      </main>
    )
  }

  const { data: tareas } = await sb.rpc('ronda_tareas_punto', {
    p_punto: p.id, p_solo_ahora: false,
  })

  const lista = ((tareas ?? []) as Record<string, unknown>[]).map((t): TareaPwa => ({
    asignacionId: String(t.asignacion_id),
    plantillaId: String(t.plantilla_id),
    codigo: String(t.plantilla_codigo),
    nombre: String(t.plantilla_nombre),
    actividad: String(t.tipo_actividad_nombre),
    pasos: Number(t.pasos ?? 0),
    minutos: t.duracion_estimada_min == null ? null : Number(t.duracion_estimada_min),
    prioridad: String(t.prioridad),
    enVentana: t.en_ventana === true,
    enTolerancia: t.en_tolerancia === true,
    ventana: t.ventana_desde && t.ventana_hasta
      ? `${String(t.ventana_desde).slice(0, 5)} a ${String(t.ventana_hasta).slice(0, 5)}`
      : 'Todo el día',
    exigeFirma: t.exige_firma === true,
    exigeGeocerca: t.exige_geocerca === true,
  }))

  return (
    <main className="px-4 py-6">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="bg-brand-green px-4 py-3 text-white">
          <p className="text-[11px] uppercase tracking-wide text-white/70">
            Punto {r.punto.codigo}
          </p>
          <h1 className="font-heading text-xl font-bold leading-tight">{r.punto.nombre}</h1>
        </div>
        <dl className="divide-y divide-gray-100 text-sm">
          <div className="flex gap-2 px-4 py-3">
            <Building2 className="mt-0.5 h-4 w-4 text-brand-green" />
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-gray-400">Sede</dt>
              <dd>{r.punto.sedeNombre}</dd>
            </div>
          </div>
          {(r.punto.zona || r.punto.piso) && (
            <div className="flex gap-2 px-4 py-3">
              <Layers className="mt-0.5 h-4 w-4 text-brand-green" />
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-gray-400">Dónde</dt>
                <dd>{[r.punto.zona, r.punto.piso].filter(Boolean).join(' · ')}</dd>
              </div>
            </div>
          )}
          {r.punto.descripcion && (
            <div className="flex gap-2 px-4 py-3">
              <MapPin className="mt-0.5 h-4 w-4 text-brand-green" />
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-gray-400">Cómo llegar</dt>
                <dd>{r.punto.descripcion}</dd>
              </div>
            </div>
          )}
        </dl>
      </div>

      <TareasDelPunto
        actor={{
          personaId: actor.personaId,
          nombre: actor.personaNombre,
          modo: actor.metodo === 'CUENTA' ? 'cuenta' : 'sesion',
          sesionId: actor.sesionId,
        }}
        punto={{
          id: p.id,
          nombre: r.punto.nombre,
          codigo: r.punto.codigo,
          lat: p.lat == null ? null : Number(p.lat),
          lng: p.lng == null ? null : Number(p.lng),
          geocercaMetros: Number(p.geocerca_metros),
          exigeGeocerca: p.exige_geocerca,
        }}
        qr={{ id: r.qrId, aperturaModo: r.aperturaModo }}
        tareas={lista}
      />
    </main>
  )
}

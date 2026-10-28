// Seguimiento PÚBLICO de un reporte hecho desde el QR: /q/estado?numero=PQ-00042
// (F5 del módulo de Puntos QR, §6.3).
//
// Quien radicó sin cuenta tiene derecho a saber en qué va su reporte, y lo único
// que se llevó fue el número. Esta página lo consulta con
// `pqrs_estado_publico()`, que SOLO responde por PQRS del canal QR y SOLO
// devuelve lo que esa persona ya sabe más el estado y la respuesta: nada de la
// bitácora interna, ni responsable, ni quién la atiende.
//
// Por qué un número basta y no hace falta más identidad: el número no es una
// credencial —se puede adivinar— y justo por eso la función no devuelve datos
// personales de nadie. Si algún día se quiere mostrar más, hace falta un enlace
// firmado de corta duración (el mecanismo del ADR-A), no este formulario.
//
// `/q/estado` es un segmento estático: en el App Router gana sobre `/q/[token]`,
// así que no choca con la ruta de la placa.

import type { Metadata } from 'next'
import { Search, ShieldAlert } from 'lucide-react'
import { getAdmin } from '@/lib/supabase/admin'

export const metadata: Metadata = {
  title: 'Consultar un reporte',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

const ESTADO_TEXTO: Record<string, { label: string; detalle: string; cls: string }> = {
  RADICADA:   { label: 'Radicada',   detalle: 'Ya quedó registrada y está en la fila de atención.', cls: 'bg-red-100 text-red-700' },
  EN_TRAMITE: { label: 'En trámite', detalle: 'Alguien la está atendiendo.',                        cls: 'bg-amber-100 text-amber-700' },
  EN_ESPERA:  { label: 'En espera',  detalle: 'Se está esperando a un tercero para resolverla.',    cls: 'bg-purple-100 text-purple-700' },
  RESPONDIDA: { label: 'Respondida', detalle: 'Ya hay una respuesta.',                              cls: 'bg-emerald-100 text-emerald-700' },
  CERRADA:    { label: 'Cerrada',    detalle: 'Se cerró el caso.',                                  cls: 'bg-gray-100 text-gray-600' },
  ANULADA:    { label: 'Anulada',    detalle: 'Se anuló el radicado.',                              cls: 'bg-gray-100 text-gray-500' },
}

interface EstadoPublico {
  numero: string
  estado: string
  tipo: string
  asunto: string | null
  categoria: string | null
  punto: string | null
  fecha_limite: string | null
  radicada_at: string | null
  respondida_at: string | null
  respuesta: string | null
}

export default async function EstadoPublicoPage({
  searchParams,
}: { searchParams: Promise<{ numero?: string }> }) {
  const { numero } = await searchParams
  const buscado = (numero ?? '').trim()
  let fila: EstadoPublico | null = null
  let fallo = false

  if (buscado) {
    try {
      const { data } = await getAdmin().rpc('pqrs_estado_publico', { p_numero: buscado })
      fila = ((Array.isArray(data) ? data[0] : data) as EstadoPublico | null) ?? null
    } catch (e) {
      console.error('[q/estado] no se pudo consultar el radicado', e)
      fallo = true
    }
  }

  const est = fila ? ESTADO_TEXTO[fila.estado] : null

  return (
    <main className="bg-brand-green-bg/40 min-h-screen px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-4">
        <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <h1 className="font-heading flex items-center gap-2 text-lg font-bold text-gray-900">
            <Search className="h-5 w-5 text-brand-green" /> Consultar un reporte
          </h1>
          <p className="font-body mt-1 text-sm text-gray-500">
            Escribe el número que te dimos al enviarlo (empieza por PQ-).
          </p>
          {/* Un GET y nada de JavaScript: es la pantalla más simple del módulo
              y tiene que abrir en cualquier celular. */}
          <form method="GET" className="mt-3 flex gap-2">
            <input
              name="numero"
              defaultValue={buscado}
              placeholder="PQ-00042"
              aria-label="Número del reporte"
              className="font-body h-12 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 font-mono text-base uppercase outline-none focus:border-brand-green"
            />
            <button
              type="submit"
              className="font-body h-12 shrink-0 rounded-xl bg-brand-green px-4 font-semibold text-white"
            >
              Buscar
            </button>
          </form>
        </div>

        {buscado && !fila && (
          <div className="rounded-2xl border border-amber-100 bg-white p-5 text-center shadow-sm">
            <ShieldAlert className="mx-auto h-9 w-9 text-amber-500" />
            <p className="font-body mt-2 text-sm text-gray-600">
              {fallo
                ? 'No se pudo consultar en este momento. Intenta de nuevo en un rato.'
                : 'No encontramos ningún reporte con ese número. Revisa que esté completo, con el PQ- y los cinco dígitos.'}
            </p>
          </div>
        )}

        {fila && est && (
          <div className="space-y-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm text-gray-400">{fila.numero}</span>
              <span className={`font-body rounded-full px-2 py-0.5 text-xs font-semibold ${est.cls}`}>
                {est.label}
              </span>
            </div>
            <p className="font-body text-sm text-gray-700">{est.detalle}</p>
            <dl className="font-body space-y-1.5 text-sm">
              {fila.asunto && <Dato etiqueta="Asunto">{fila.asunto}</Dato>}
              {fila.categoria && <Dato etiqueta="De qué se trata">{fila.categoria}</Dato>}
              {fila.punto && <Dato etiqueta="Punto">{fila.punto}</Dato>}
              {fila.fecha_limite && (
                <Dato etiqueta="Fecha de respuesta">{fecha(fila.fecha_limite)}</Dato>
              )}
            </dl>
            {fila.respuesta && (
              <div className="rounded-xl bg-emerald-50 px-3 py-2">
                <p className="font-heading text-xs font-semibold text-emerald-800">Respuesta</p>
                <p className="font-body mt-0.5 whitespace-pre-wrap text-sm text-emerald-900">
                  {fila.respuesta}
                </p>
              </div>
            )}
          </div>
        )}

        <p className="font-body text-center text-[11px] text-gray-400">
          Conserjes Inmobiliarios Ltda.
        </p>
      </div>
    </main>
  )
}

function Dato({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5">
      <dt className="shrink-0 text-gray-500">{etiqueta}:</dt>
      <dd className="min-w-0 text-gray-800">{children}</dd>
    </div>
  )
}

/** "2026-11-18" → "18/11/2026". Sin `new Date`: el servidor va en UTC. */
function fecha(iso: string): string {
  const [a, m, d] = iso.slice(0, 10).split('-')
  return d && m && a ? `${d}/${m}/${a}` : iso
}

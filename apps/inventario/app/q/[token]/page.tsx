// Página PÚBLICA del QR de un punto de control: /q/<token> (F2).
//
// La ruta es `/q/`, no `/p/`: lo decide docs/puntos-qr-whatsapp/03-nomenclatura.md
// §3, y es la decisión más irreversible del módulo porque el token va impreso en
// una placa pegada a una pared. Donde los documentos 00 y 02 digan `/p/`, hay
// que leer `/q/`.
//
// Qué hace F2 y qué NO:
//   · resuelve el punto, verifica la firma y rechaza lo que debe rechazar,
//     dejando siempre un evento de auditoría (ver ./resolver.ts);
//   · muestra una página mínima: nombre del punto y lugar.
// Lo que se bifurca desde aquí es de fases posteriores y está marcado abajo en
// un solo sitio, el bloque "Lo que sigue": ejecutar la ronda es F4 (con el
// enlace + PIN del ADR-A y la app nativa), radicar una PQRS pública es F5 y
// reportar por WhatsApp es F9. No se construye ninguna de las tres aquí.

import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import {
  MapPin, Building2, ShieldCheck, ShieldAlert, Keyboard, Layers,
  MessageSquareWarning, Search, Cog, Tag,
} from 'lucide-react'
import { formatearManual } from '@/lib/puntos-qr'
import { getAdmin } from '@/lib/supabase/admin'
import { ESTADO_ACTIVO } from '@/lib/activos'
import { resolverCodigo, TEXTO_RECHAZO } from '../decidir'
import { puertaSupabase } from '../puerta-supabase'

export const metadata: Metadata = {
  // El mismo título para los dos casos: la etiqueta de la pestaña no tiene por
  // qué decir si lo que se escaneó es un punto o un equipo.
  title: 'Punto de control',
  robots: { index: false, follow: false },
}
// Cada escaneo es una visita distinta y deja auditoría: nada que cachear.
export const dynamic = 'force-dynamic'

/** IP del solicitante tal como la reporta el proxy de Vercel. Es un dato de
 *  auditoría, no una credencial: se guarda para reconocer sondeos. */
async function ipDelSolicitante(): Promise<string | null> {
  const h = await headers()
  const directa = h.get('x-real-ip')
  if (directa) return directa.trim()
  const reenviada = h.get('x-forwarded-for')
  // Puede traer una cadena "cliente, proxy1, proxy2": la primera es el cliente.
  const primera = reenviada?.split(',')[0]?.trim()
  // INET rechaza cualquier cosa que no sea una dirección, así que se descarta
  // lo que no lo parezca en vez de hacer fallar el INSERT de auditoría.
  if (!primera) return null
  return /^[0-9a-fA-F.:]+$/.test(primera) ? primera : null
}

export default async function PuntoPublicoPage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // Si la base no contesta (el corte de 8 s de Supabase, por ejemplo), esta
  // página no puede responder un 500: la está mirando alguien parado frente a
  // una placa pegada a una pared. Se le dice que vuelva a intentar.
  let r
  try {
    r = await resolverCodigo(
      decodeURIComponent(token), await ipDelSolicitante(), puertaSupabase(),
    )
  } catch (e) {
    console.error('[q] no se pudo resolver el código', e)
    return (
      <Marco>
        <div className="rounded-2xl border border-amber-100 bg-white p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="font-heading mt-3 text-lg font-bold text-gray-900">
            No pudimos abrir el punto
          </h1>
          <p className="font-body mt-2 text-sm text-gray-600">
            Hubo un problema de conexión. Vuelve a intentarlo en un momento.
          </p>
        </div>
      </Marco>
    )
  }

  if (!r.ok) {
    const t = TEXTO_RECHAZO[r.motivo]
    return (
      <Marco>
        <div className="rounded-2xl border border-red-100 bg-white p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-red-500" />
          <h1 className="font-heading mt-3 text-lg font-bold text-gray-900">{t.titulo}</h1>
          <p className="font-body mt-2 text-sm text-gray-600">{t.detalle}</p>
          <p className="font-body mt-4 text-[11px] uppercase tracking-wide text-gray-400">
            Código de referencia: {r.motivo}
          </p>
        </div>
      </Marco>
    )
  }

  // ── La placa de un ACTIVO del cliente (F6) ──────────────────────────────────
  // Se muestra lo mismo que de un punto: lo que ya va impreso en la placa más el
  // nombre del equipo y el de la sede. Los documentos, los medidores y las
  // lecturas NO son públicos; para eso está /rondas/activos, con sesión.
  if (r.objeto === 'ACTIVO') {
    const a = r.activo
    return (
      <Marco>
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="bg-brand-green px-5 py-4 text-white">
            <p className="font-body text-[11px] uppercase tracking-wide text-white/70">
              Equipo {a.codigo}
            </p>
            <h1 className="font-heading text-xl font-bold leading-tight">{a.nombre}</h1>
          </div>

          <dl className="divide-y divide-gray-100">
            <Dato icono={<Building2 className="h-4 w-4" />} titulo="Sede">
              {a.sedeNombre}
              {a.sedeDireccion && (
                <span className="block text-xs text-gray-500">{a.sedeDireccion}</span>
              )}
              {a.sedeCiudad && !a.sedeDireccion && (
                <span className="block text-xs text-gray-500">{a.sedeCiudad}</span>
              )}
            </Dato>

            {a.lugar && (
              <Dato icono={<Layers className="h-4 w-4" />} titulo="Dónde está">
                {a.lugar}
              </Dato>
            )}

            {(a.tipo || a.marca || a.modelo) && (
              <Dato icono={<Tag className="h-4 w-4" />} titulo="Qué es">
                {[a.tipo, [a.marca, a.modelo].filter(Boolean).join(' ')]
                  .filter(Boolean).join(' · ')}
              </Dato>
            )}

            <Dato icono={<Cog className="h-4 w-4" />} titulo="Estado">
              {ESTADO_ACTIVO[a.estado].label}
              <span className="block text-xs text-gray-500">
                {ESTADO_ACTIVO[a.estado].detalle}
              </span>
            </Dato>

            {a.descripcion && (
              <Dato icono={<MapPin className="h-4 w-4" />} titulo="Detalle">
                {a.descripcion}
              </Dato>
            )}

            <Dato
              icono={r.aperturaModo === 'QR'
                ? <ShieldCheck className="h-4 w-4" />
                : <Keyboard className="h-4 w-4" />}
              titulo={r.aperturaModo === 'QR' ? 'Código verificado' : 'Abierto con el código impreso'}
            >
              <span className="font-mono">{formatearManual(r.codigoManual)}</span>
              <span className="block text-xs text-gray-500">
                {r.aperturaModo === 'QR'
                  ? `Versión ${r.version} de la placa, con firma válida.`
                  : `Versión ${r.version} de la placa. Se abrió tecleando el código, no escaneando.`}
              </span>
            </Dato>
          </dl>
        </div>

        {/* Lo que sigue para un activo es de F7 (la orden de trabajo sobre este
            equipo) y de F5 (radicar una PQRS desde su placa). No se construye
            ninguna de las dos aquí. */}
        <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-5">
          <p className="font-heading text-sm font-semibold text-gray-700">¿Qué quieres hacer?</p>
          <p className="font-body mt-1 text-sm text-gray-500">
            Reportar una falla de este equipo y ver su mantenimiento todavía no está disponible:
            se habilita en la siguiente entrega del módulo. Por ahora, avisa a tu supervisor.
          </p>
        </div>
      </Marco>
    )
  }

  const p = r.punto
  // F5: ¿este contrato recibe PQRS por el QR? Si no, no se ofrece el botón.
  // Una sola llamada, y la página sigue sirviendo si la base no contesta.
  let pqrsPublica = false
  try {
    const { data } = await getAdmin().rpc('pqrs_publica_activa', { p_qr: r.qrId })
    pqrsPublica = data === true
  } catch (e) {
    console.error('[q] no se pudo saber si el contrato recibe PQRS pública', e)
  }

  return (
    <Marco>
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="bg-brand-green px-5 py-4 text-white">
          <p className="font-body text-[11px] uppercase tracking-wide text-white/70">
            Punto de control {p.codigo}
          </p>
          <h1 className="font-heading text-xl font-bold leading-tight">{p.nombre}</h1>
        </div>

        <dl className="divide-y divide-gray-100">
          <Dato icono={<Building2 className="h-4 w-4" />} titulo="Sede">
            {p.sedeNombre}
            {p.sedeDireccion && (
              <span className="block text-xs text-gray-500">{p.sedeDireccion}</span>
            )}
            {p.sedeCiudad && !p.sedeDireccion && (
              <span className="block text-xs text-gray-500">{p.sedeCiudad}</span>
            )}
          </Dato>

          {(p.zona || p.piso) && (
            <Dato icono={<Layers className="h-4 w-4" />} titulo="Ubicación">
              {[p.zona, p.piso].filter(Boolean).join(' · ')}
            </Dato>
          )}

          {p.descripcion && (
            <Dato icono={<MapPin className="h-4 w-4" />} titulo="Cómo llegar">
              {p.descripcion}
            </Dato>
          )}

          <Dato
            icono={r.aperturaModo === 'QR'
              ? <ShieldCheck className="h-4 w-4" />
              : <Keyboard className="h-4 w-4" />}
            titulo={r.aperturaModo === 'QR' ? 'Código verificado' : 'Abierto con el código impreso'}
          >
            <span className="font-mono">{formatearManual(r.codigoManual)}</span>
            <span className="block text-xs text-gray-500">
              {r.aperturaModo === 'QR'
                ? `Versión ${r.version} de la placa, con firma válida.`
                : `Versión ${r.version} de la placa. Se abrió tecleando el código, no escaneando.`}
            </span>
          </Dato>
        </dl>
      </div>

      {/* Los activos del cliente que están en ESTE punto (F6, §2.1): así un
          equipo que está justo donde ya hay una placa no necesita placa propia
          y se llega a él por la del punto. */}
      {r.activos.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
          <p className="font-body border-b border-gray-100 px-5 py-2.5 text-[11px] uppercase tracking-wide text-gray-400">
            Equipos en este punto
          </p>
          <ul className="divide-y divide-gray-100">
            {r.activos.map((a) => (
              <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                <Cog className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" />
                <div className="min-w-0">
                  <p className="font-body text-sm text-gray-800">{a.nombre}</p>
                  <p className="font-body text-xs text-gray-500">
                    <span className="font-mono">{a.codigo}</span>
                    {a.tipo && <> · {a.tipo}</>}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────────────
          Lo que sigue — EL PUNTO DE BIFURCACIÓN.
          Aquí es donde esta página se abre en tres caminos, y los tres son de
          fases posteriores. Se deja dicho en pantalla para que quien escanee hoy
          no se quede mirando una página muerta, y marcado en el código para que
          la fase que llegue sepa exactamente dónde entra:
            · F4 — ejecutar la ronda: identidad por enlace + PIN (ADR-A), tareas
              del punto, evidencia y cierre del reporte. Conserva el destino
              (/q/<token>) al pasar por la identificación.
            · F5 — HECHO: radicar una PQRS pública desde este mismo QR, cuando
              `grupo_reglas.pqrs_publico` está activo para el contrato. Entra por
              /q/<token>/pqrs y escribe por /api/pqrs/publica.
            · F9 — reportar por WhatsApp: abre wa.me con el código del punto.
          NO construir las otras dos aquí.
         ─────────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-5">
        <p className="font-heading text-sm font-semibold text-gray-700">¿Qué quieres hacer?</p>
        {pqrsPublica ? (
          <>
            <p className="font-body mt-1 text-sm text-gray-500">
              Si viste algo que hay que arreglar en este lugar, cuéntanoslo: queda radicado y con
              fecha de respuesta. No necesitas cuenta.
            </p>
            <Link
              href={`/q/${encodeURIComponent(token)}/pqrs`}
              className="font-body mt-3 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand-green text-base font-bold text-white"
            >
              <MessageSquareWarning className="h-5 w-5" /> Reportar una novedad
            </Link>
            <Link
              href="/q/estado"
              className="font-body mt-2 flex h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600"
            >
              <Search className="h-4 w-4" /> Consultar un reporte que ya hice
            </Link>
          </>
        ) : (
          <p className="font-body mt-1 text-sm text-gray-500">
            Las tareas de este punto y el reporte con evidencia todavía no están disponibles: se
            habilitan en las siguientes entregas del módulo. Por ahora, informa a tu supervisor que
            llegaste al punto.
          </p>
        )}
      </div>
    </Marco>
  )
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-brand-green-bg/40 px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-4">
        {children}
        <p className="font-body text-center text-[11px] text-gray-400">
          Conserjes Inmobiliarios Ltda.
        </p>
      </div>
    </main>
  )
}

function Dato({
  icono, titulo, children,
}: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-5 py-3.5">
      <span className="mt-0.5 text-brand-green">{icono}</span>
      <div className="min-w-0">
        <dt className="font-body text-[11px] uppercase tracking-wide text-gray-400">{titulo}</dt>
        <dd className="font-body text-sm text-gray-800">{children}</dd>
      </div>
    </div>
  )
}

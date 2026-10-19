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
import { headers } from 'next/headers'
import { MapPin, Building2, ShieldCheck, ShieldAlert, Keyboard, Layers } from 'lucide-react'
import { formatearManual } from '@/lib/puntos-qr'
import { resolverCodigo, TEXTO_RECHAZO } from '../decidir'
import { puertaSupabase } from '../puerta-supabase'

export const metadata: Metadata = {
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
  const r = await resolverCodigo(
    decodeURIComponent(token), await ipDelSolicitante(), puertaSupabase(),
  )

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

  const p = r.punto
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

      {/* ───────────────────────────────────────────────────────────────────
          Lo que sigue — EL PUNTO DE BIFURCACIÓN.
          Aquí es donde esta página se abre en tres caminos, y los tres son de
          fases posteriores. Se deja dicho en pantalla para que quien escanee hoy
          no se quede mirando una página muerta, y marcado en el código para que
          la fase que llegue sepa exactamente dónde entra:
            · F4 — ejecutar la ronda: identidad por enlace + PIN (ADR-A), tareas
              del punto, evidencia y cierre del reporte. Conserva el destino
              (/q/<token>) al pasar por la identificación.
            · F5 — radicar una PQRS pública desde este mismo QR, si
              `grupo_reglas.pqrs_publico` está activo para el contrato.
            · F9 — reportar por WhatsApp: abre wa.me con el código del punto.
          NO construir ninguna de las tres aquí.
         ─────────────────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-dashed border-gray-200 bg-white/60 p-5">
        <p className="font-heading text-sm font-semibold text-gray-700">¿Qué quieres hacer?</p>
        <p className="font-body mt-1 text-sm text-gray-500">
          Las tareas de este punto, el reporte con evidencia y la radicación de una PQRS
          todavía no están disponibles: se habilitan en las siguientes entregas del módulo.
          Por ahora, informa a tu supervisor que llegaste al punto.
        </p>
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

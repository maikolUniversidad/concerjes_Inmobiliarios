// Página PÚBLICA para radicar una PQRS desde el QR de un punto: /q/<token>/pqrs
// (F5 del módulo de Puntos QR).
//
// Es la CONTINUACIÓN DEL PUNTO DE BIFURCACIÓN que dejó F2 en `../page.tsx`: la
// resolución del código —forma, FIRMA, estado del QR, vigencia del contrato,
// estado del punto, y el evento de auditoría de cada rechazo— es la MISMA
// función que usa la página del punto. No se reimplementa aquí.
//
// Lo que esta página agrega:
//   · pregunta si ESTE contrato recibe PQRS por el QR (`grupo_reglas.pqrs_publico`,
//     vía `pqrs_publica_activa`), y si no, lo dice sin ofrecer el formulario;
//   · trae el catálogo de categorías que aplica al contrato;
//   · muestra el formulario, que escribe por `/api/pqrs/publica`.
//
// Sin sesión, a propósito: quien escanea es un residente con su celular. La
// autoridad de la página es la FIRMA del token, no una cookie, igual que en F2.

import type { Metadata } from 'next'
import Link from 'next/link'
import { headers } from 'next/headers'
import { ArrowLeft, MessageSquareWarning, ShieldAlert } from 'lucide-react'
import { getAdmin } from '@/lib/supabase/admin'
import type { CategoriaPublica } from '@/lib/pqrs/publico'
import { resolverCodigo, TEXTO_RECHAZO } from '../../decidir'
import { puertaSupabase } from '../../puerta-supabase'
import { FormularioPublico } from './FormularioPublico'

export const metadata: Metadata = {
  title: 'Reportar una novedad',
  robots: { index: false, follow: false },
}
export const dynamic = 'force-dynamic'

async function ipDelSolicitante(): Promise<string | null> {
  const h = await headers()
  const directa = h.get('x-real-ip')
  if (directa && /^[0-9a-fA-F.:]+$/.test(directa.trim())) return directa.trim()
  const primera = h.get('x-forwarded-for')?.split(',')[0]?.trim()
  return primera && /^[0-9a-fA-F.:]+$/.test(primera) ? primera : null
}

export default async function PqrsPublicaPage({
  params,
}: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const codigo = decodeURIComponent(token)

  // Si la base no contesta (el corte de 8 s de Supabase, por ejemplo), esta
  // página NO puede reventar con un 500: la está mirando un residente parado
  // frente a una placa. Se le dice que vuelva a intentar.
  let r
  try {
    r = await resolverCodigo(codigo, await ipDelSolicitante(), puertaSupabase())
  } catch (e) {
    console.error('[q/pqrs] no se pudo resolver el código', e)
    return (
      <Marco>
        <Aviso
          titulo="No pudimos abrir el punto"
          detalle="Hubo un problema de conexión. Vuelve a intentarlo en un momento."
        />
      </Marco>
    )
  }

  if (!r.ok) {
    const t = TEXTO_RECHAZO[r.motivo]
    return (
      <Marco>
        <Aviso titulo={t.titulo} detalle={t.detalle} />
      </Marco>
    )
  }

  // La placa de un ACTIVO del cliente (F6) también entra por /q/<token>, y desde
  // F6 esta resolución puede ser de un activo y no de un punto. Radicar una PQRS
  // sobre un equipo todavía no existe: la novedad de un activo es una orden de
  // trabajo, que es F7. Así que aquí se dice la verdad en vez de radicar la
  // novedad contra un punto que no es el que se escaneó.
  if (r.objeto !== 'PUNTO') {
    return (
      <Marco>
        <Aviso
          titulo="Por aquí no se reporta este equipo"
          detalle="Escaneaste la placa de un equipo, y los reportes por el código son de los puntos de control. Avisa al personal del lugar o a tu supervisor."
        />
        <Volver token={token} />
      </Marco>
    )
  }

  // ¿Este contrato recibe PQRS por el código del punto? Por función y no por
  // lectura de `grupo_reglas`, para que la página pública no tenga que leer una
  // tabla de contrato entera. La RPC lo vuelve a comprobar al escribir.
  const sb = getAdmin()
  const { data: activa, error: errorActiva } = await sb.rpc('pqrs_publica_activa', { p_qr: r.qrId })
  if (errorActiva) {
    // Un fallo de conexión NO se puede confundir con «este contrato no recibe
    // reportes»: son dos mensajes distintos y uno de los dos es mentira.
    console.error('[q/pqrs] no se pudo saber si el contrato recibe PQRS', errorActiva.message)
    return (
      <Marco>
        <Aviso
          titulo="No pudimos abrir el punto"
          detalle="Hubo un problema de conexión. Vuelve a intentarlo en un momento."
        />
      </Marco>
    )
  }
  if (activa !== true) {
    return (
      <Marco>
        <Aviso
          titulo="Este punto no recibe reportes por el código"
          detalle="La administración de esta sede no tiene habilitada la radicación de PQRS por el QR. Comunícale la novedad al personal del lugar o a la administración."
        />
        <Volver token={token} />
      </Marco>
    )
  }

  const { data, error: errorCat } = await sb.rpc('pqrs_categorias_de', { p_grupo: r.grupoId })
  const categorias = (data ?? []) as CategoriaPublica[]
  if (errorCat || categorias.length === 0) {
    if (errorCat) console.error('[q/pqrs] no se pudo traer el catálogo', errorCat.message)
    return (
      <Marco>
        <Aviso
          titulo={errorCat ? 'No pudimos abrir el formulario' : 'Todavía no se puede reportar aquí'}
          detalle={errorCat
            ? 'Hubo un problema de conexión. Vuelve a intentarlo en un momento.'
            : 'Este contrato no tiene categorías de PQRS configuradas. Avisa al personal del lugar.'}
        />
        <Volver token={token} />
      </Marco>
    )
  }

  return (
    <Marco>
      <div className="rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="bg-brand-green px-5 py-4 text-white">
          <p className="font-body text-[11px] uppercase tracking-wide text-white/70">
            {r.punto.sedeNombre}
          </p>
          <h1 className="font-heading flex items-center gap-2 text-lg font-bold leading-tight">
            <MessageSquareWarning className="h-5 w-5 shrink-0" /> Reportar una novedad
          </h1>
          <p className="font-body mt-1 text-sm text-white/80">
            {r.punto.nombre}
            {r.punto.zona || r.punto.piso
              ? ` · ${[r.punto.zona, r.punto.piso].filter(Boolean).join(' · ')}`
              : ''}
          </p>
        </div>
        <FormularioPublico
          codigo={codigo}
          modo={r.aperturaModo}
          categorias={categorias}
          punto={r.punto.nombre}
        />
      </div>
      <Volver token={token} />
    </Marco>
  )
}

function Volver({ token }: { token: string }) {
  return (
    <Link
      href={`/q/${encodeURIComponent(token)}`}
      className="font-body inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
    >
      <ArrowLeft className="h-4 w-4" /> Volver al punto
    </Link>
  )
}

function Aviso({ titulo, detalle }: { titulo: string; detalle: string }) {
  return (
    <div className="rounded-2xl border border-amber-100 bg-white p-6 text-center shadow-sm">
      <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
      <h1 className="font-heading mt-3 text-lg font-bold text-gray-900">{titulo}</h1>
      <p className="font-body mt-2 text-sm text-gray-600">{detalle}</p>
    </div>
  )
}

function Marco({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-brand-green-bg/40 min-h-screen px-4 py-8">
      <div className="mx-auto w-full max-w-md space-y-4">
        {children}
        <p className="font-body text-center text-[11px] text-gray-400">
          Conserjes Inmobiliarios Ltda.
        </p>
      </div>
    </main>
  )
}

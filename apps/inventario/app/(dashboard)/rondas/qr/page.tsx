import type { Metadata } from 'next'
import { QrCode } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { traerTodo } from '@/lib/supabase/paginado'
import { requirePermiso, getPermisosUsuario } from '@/lib/permisos-server'
import { llaveActual, secretoDeLlave } from '@/lib/puntos-qr-firma'
import type { EstadoPunto, EstadoQr } from '@/lib/puntos-qr'
import { QrClient, type LoteReciente, type PuntoQr } from './QrClient'

export const metadata: Metadata = { title: 'Códigos QR de los puntos' }
export const dynamic = 'force-dynamic'

interface PuntoRaw {
  id: string; codigo: string; nombre: string; piso: string | null
  estado: EstadoPunto; sede_id: string; sede_nombre: string | null
  grupo_id: string
  zona: { nombre: string } | null
  sede: { nombre: string; ciudad: string | null } | null
  grupo: { codigo: string; nombre: string; arte_color: string | null } | null
  ronda_qr: {
    id: string; version: number; estado: EstadoQr; token: string
    codigo_manual: string; impresiones: number; firma_llave_id: string
    created_at: string; motivo_cambio: string | null
  }[] | null
}
interface LoteRaw {
  id: string; numero: string; nombre: string | null; formato: string
  cantidad: number; generado_at: string
  sede: { nombre: string } | null
}

export default async function QrPage() {
  await requirePermiso('ver_puntos_ronda')
  const permisos = await getPermisosUsuario()
  const supabase = await createClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any

  const [puntosRaw, lotesRaw] = await Promise.all([
    traerTodo<PuntoRaw>((desde, hasta) => sb.from('ronda_puntos')
      .select(`id, codigo, nombre, piso, estado, sede_id, sede_nombre, grupo_id,
               zona:ronda_zonas ( nombre ),
               sede:sedes ( nombre, ciudad ),
               grupo:grupos_contrato ( codigo, nombre, arte_color ),
               ronda_qr ( id, version, estado, token, codigo_manual, impresiones,
                          firma_llave_id, created_at, motivo_cambio )`)
      // Orden estable (sede + orden + código + id): `traerTodo` pagina con
      // OFFSET y sin un orden único las páginas repiten o pierden filas.
      .order('sede_nombre').order('orden').order('codigo').order('id')
      .range(desde, hasta), { etiqueta: 'puntos con QR' }),
    traerTodo<LoteRaw>((desde, hasta) => sb.from('ronda_qr_lotes')
      .select('id, numero, nombre, formato, cantidad, generado_at, sede:sedes ( nombre )')
      .order('generado_at', { ascending: false }).order('id')
      .range(desde, hasta), { etiqueta: 'lotes de impresión', maximo: 1000 }),
  ])

  const puntos: PuntoQr[] = puntosRaw.map((p) => {
    const versiones = (p.ronda_qr ?? []).slice()
      .sort((a, b) => Number(b.version) - Number(a.version))
    const activo = versiones.find((q) => q.estado === 'ACTIVO') ?? null
    return {
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      piso: p.piso,
      estado: p.estado,
      sedeId: p.sede_id,
      sedeNombre: p.sede?.nombre ?? p.sede_nombre ?? '',
      sedeCiudad: p.sede?.ciudad ?? null,
      zonaNombre: p.zona?.nombre ?? null,
      contrato: p.grupo?.codigo ?? '—',
      contratoNombre: p.grupo?.nombre ?? '',
      // El arte es del CONTRATO (corregido por el complemento 2, §2.4): el
      // color de la placa sale de aquí. `arte_logo_path` del contrato todavía
      // no se puede resolver — su bucket es del ADR-C y se crea en F4 —, así
      // que la placa lleva el logo de la empresa que ya está en /public.
      arteColor: p.grupo?.arte_color ?? null,
      qrActivo: activo
        ? {
            id: activo.id,
            version: Number(activo.version),
            token: activo.token,
            codigoManual: activo.codigo_manual,
            impresiones: Number(activo.impresiones),
            firmaLlaveId: activo.firma_llave_id,
          }
        : null,
      historial: versiones.map((q) => ({
        id: q.id,
        version: Number(q.version),
        estado: q.estado,
        codigoManual: q.codigo_manual,
        impresiones: Number(q.impresiones),
        creadoEn: q.created_at,
        motivo: q.motivo_cambio,
      })),
    }
  })

  const lotes: LoteReciente[] = lotesRaw.slice(0, 20).map((l) => ({
    id: l.id,
    numero: l.numero,
    nombre: l.nombre,
    formato: l.formato,
    cantidad: Number(l.cantidad),
    generadoEn: l.generado_at,
    sedeNombre: l.sede?.nombre ?? '',
  }))

  // La llave de firma vive en variables de entorno y nunca llega al navegador:
  // lo único que viaja es si está configurada, para poder avisar ANTES de que
  // alguien mande a imprimir placas que no van a abrir.
  const llave = llaveActual()
  const llaveLista = !!llave && !!secretoDeLlave(llave)

  const activos = puntos.filter((p) => p.qrActivo).length
  const sinEmitir = puntos.filter((p) => !p.qrActivo && p.estado !== 'RETIRADO').length

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h1 className="font-heading flex items-center gap-2 text-2xl font-bold text-gray-900">
          <QrCode className="h-6 w-6 text-brand-green" /> Códigos QR de los puntos
        </h1>
        <p className="font-body mt-0.5 text-sm text-gray-500">
          {activos} puntos con código activo · {sinEmitir} sin emitir · el código va firmado y
          va impreso: cambiarlo obliga a volver a la pared a cambiar la placa
        </p>
      </div>

      <QrClient
        puntos={puntos}
        lotes={lotes}
        llaveLista={llaveLista}
        llaveId={llave}
        baseUrl={process.env.APP_BASE_URL ?? ''}
        puedeGestionar={permisos.puede('gestionar_qr_ronda')}
      />
    </div>
  )
}

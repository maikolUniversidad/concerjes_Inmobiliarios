'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import {
  Loader2, ArrowLeft, Receipt, Copy, Check, ExternalLink, Upload, FileText,
  ShieldCheck, Info, CalendarClock, Paperclip,
} from 'lucide-react'
import { toast } from 'sonner'
import { getPortalSupabase, tokenActual } from '@/lib/supabase/portal'
import { usePortal } from '../../_portal/PortalProvider'
import {
  ESTADOS_COBRO, ESTADOS_PAGO, estadoCobro, fmtMoneda, fmtFecha, fmtFechaHora,
} from '../../_portal/datos'

interface Item { id: string; descripcion: string; cantidad: number; valor_unitario: number; total: number }
interface Metodo {
  id: string; codigo: string; nombre: string; tipo: string; icono: string | null
  instrucciones: string | null; titular: string | null; entidad: string | null
  numero_cuenta: string | null; tipo_cuenta: string | null; url_pago: string | null
  requiere_comprobante: boolean; requiere_referencia: boolean
}
interface Pago {
  id: string; monto: number; metodo_nombre: string | null; referencia: string | null
  fecha_pago: string; estado: string; motivo_rechazo: string | null; created_at: string
  comprobante_path: string | null
}
interface Cobro {
  id: string; numero: string; concepto: string; tipo: string
  subtotal: number; descuento: number; iva_porcentaje: number; iva_valor: number
  total: number; pagado: number; saldo: number; estado: string
  fecha_emision: string | null; fecha_vencimiento: string | null
  link_pago: string | null; notas: string | null
  solicitudes_servicio_hogar: { id: string; numero: string; tipos_servicio_hogar: { nombre: string } | null } | null
}
interface Parametros {
  permitir_pago_parcial: boolean
  instrucciones_pago: string | null
  politica_cancelacion: string | null
  terminos: string | null
}

export default function CobroDetallePage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const { session } = usePortal()

  const [cobro, setCobro] = useState<Cobro | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [pagos, setPagos] = useState<Pago[]>([])
  const [metodos, setMetodos] = useState<Metodo[]>([])
  const [params, setParams] = useState<Parametros | null>(null)
  const [cargando, setCargando] = useState(true)

  const cargar = useCallback(async () => {
    const sb = getPortalSupabase()
    const [c, it, pg, mt, pr] = await Promise.all([
      sb.from('cobros_servicio_hogar')
        .select('*, solicitudes_servicio_hogar(id, numero, tipos_servicio_hogar(nombre))')
        .eq('id', id).maybeSingle(),
      sb.from('cobro_items_hogar').select('*').eq('cobro_id', id).order('orden'),
      sb.from('pagos_hogar').select('*').eq('cobro_id', id).order('created_at', { ascending: false }),
      sb.from('metodos_pago_hogar').select('*').eq('activo', true).eq('visible_cliente', true).order('orden'),
      sb.from('parametros_pago_hogar').select('permitir_pago_parcial, instrucciones_pago, politica_cancelacion, terminos').eq('codigo', 'DEFAULT').maybeSingle(),
    ])
    setCobro((c.data as unknown as Cobro) ?? null)
    setItems((it.data as unknown as Item[]) ?? [])
    setPagos((pg.data as unknown as Pago[]) ?? [])
    setMetodos((mt.data as unknown as Metodo[]) ?? [])
    setParams((pr.data as unknown as Parametros) ?? null)
    setCargando(false)
  }, [id])

  useEffect(() => { cargar() }, [cargar])

  if (cargando) {
    return <div className="flex justify-center py-20"><Loader2 className="h-7 w-7 animate-spin text-brand-green" /></div>
  }

  if (!cobro) {
    return (
      <div className="mx-auto max-w-2xl rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center">
        <p className="font-heading text-lg font-bold text-gray-900">Cuenta de cobro no disponible</p>
        <p className="mt-1 text-sm text-gray-500">No encontramos este cobro o ya no está disponible.</p>
        <Link href="/portal/pagos" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark">
          <ArrowLeft className="h-4 w-4" /> Volver a mis pagos
        </Link>
      </div>
    )
  }

  const est = estadoCobro(cobro.estado, cobro.fecha_vencimiento, Number(cobro.saldo))
  const badge = ESTADOS_COBRO[est] ?? ESTADOS_COBRO.EMITIDO
  const porPagar = ['EMITIDO', 'PARCIAL'].includes(cobro.estado) && Number(cobro.saldo) > 0
  const enVerificacion = pagos.some((p) => p.estado === 'REPORTADO')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <button onClick={() => router.push('/portal/pagos')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand-green hover:underline">
        <ArrowLeft className="h-4 w-4" /> Mis pagos
      </button>

      {/* Encabezado */}
      <div className="rounded-2xl border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-green/10 text-brand-green">
              <Receipt className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-heading text-xl font-bold text-gray-900">{cobro.concepto}</h1>
              <p className="text-xs text-gray-400">
                {cobro.numero}
                {cobro.solicitudes_servicio_hogar ? ` · Servicio ${cobro.solicitudes_servicio_hogar.numero}` : ''}
              </p>
            </div>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${badge.bg} ${badge.texto}`}>{badge.label}</span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Dato label="Total" valor={fmtMoneda(cobro.total)} />
          <Dato label="Pagado" valor={fmtMoneda(cobro.pagado)} />
          <Dato label="Saldo" valor={fmtMoneda(cobro.saldo)} destacado={Number(cobro.saldo) > 0} />
        </div>

        {cobro.fecha_vencimiento && porPagar && (
          <p className={`mt-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${est === 'VENCIDO' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
            <CalendarClock className="h-4 w-4 shrink-0" />
            {est === 'VENCIDO'
              ? `Venció el ${fmtFecha(cobro.fecha_vencimiento).replace(/,.*/, '')}.`
              : `Vence el ${fmtFecha(cobro.fecha_vencimiento).replace(/,.*/, '')}.`}
          </p>
        )}
      </div>

      {/* Detalle */}
      {items.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <h2 className="border-b border-gray-100 px-5 py-3 font-heading font-bold text-gray-900">Detalle</h2>
          <ul className="divide-y divide-gray-50">
            {items.map((it) => (
              <li key={it.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-gray-800">{it.descripcion}</p>
                  {Number(it.cantidad) !== 1 && (
                    <p className="text-xs text-gray-400">{Number(it.cantidad)} × {fmtMoneda(it.valor_unitario)}</p>
                  )}
                </div>
                <span className="shrink-0 font-semibold text-gray-900">{fmtMoneda(it.total)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1.5 border-t border-gray-100 px-5 py-4 text-sm">
            <Fila label="Subtotal" valor={fmtMoneda(cobro.subtotal)} />
            {Number(cobro.descuento) > 0 && <Fila label="Descuento" valor={`− ${fmtMoneda(cobro.descuento)}`} />}
            {Number(cobro.iva_valor) > 0 && <Fila label={`IVA (${Number(cobro.iva_porcentaje)}%)`} valor={fmtMoneda(cobro.iva_valor)} />}
            <div className="flex items-center justify-between border-t border-gray-100 pt-2 font-heading text-base font-bold">
              <span className="text-gray-900">Total</span>
              <span className="text-brand-green">{fmtMoneda(cobro.total)}</span>
            </div>
          </dl>
        </section>
      )}

      {cobro.notas && (
        <p className="flex gap-2 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          <Info className="h-4 w-4 shrink-0 text-brand-green" /> {cobro.notas}
        </p>
      )}

      {/* Pagar */}
      {porPagar && (
        <PagarCobro
          cobro={cobro}
          metodos={metodos}
          permitirParcial={params?.permitir_pago_parcial ?? true}
          instrucciones={params?.instrucciones_pago ?? null}
          clienteId={session.user.id}
          onListo={cargar}
        />
      )}

      {!porPagar && cobro.estado === 'PAGADO' && (
        <div className="flex items-center gap-3 rounded-2xl border border-green-200 bg-green-50 p-5">
          <ShieldCheck className="h-6 w-6 shrink-0 text-brand-green" />
          <div>
            <p className="font-heading font-bold text-gray-900">Cuenta pagada</p>
            <p className="text-sm text-gray-600">Recibimos el pago completo de esta cuenta de cobro. ¡Gracias!</p>
          </div>
        </div>
      )}

      {enVerificacion && (
        <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <Info className="h-4 w-4 shrink-0" />
          Tienes un pago reportado en verificación. Te avisamos apenas lo confirmemos.
        </p>
      )}

      {/* Historial de pagos */}
      {pagos.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
          <h2 className="border-b border-gray-100 px-5 py-3 font-heading font-bold text-gray-900">Pagos reportados</h2>
          <ul className="divide-y divide-gray-50">
            {pagos.map((p) => {
              const b = ESTADOS_PAGO[p.estado] ?? ESTADOS_PAGO.REPORTADO
              return (
                <li key={p.id} className="px-5 py-3.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{fmtMoneda(p.monto)}</p>
                      <p className="truncate text-xs text-gray-400">
                        {p.metodo_nombre ?? 'Pago'} · {fmtFechaHora(p.created_at)}
                        {p.referencia ? ` · ref. ${p.referencia}` : ''}
                      </p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${b.bg} ${b.texto}`}>{b.label}</span>
                  </div>
                  {p.estado === 'RECHAZADO' && p.motivo_rechazo && (
                    <p className="mt-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs text-red-700">{p.motivo_rechazo}</p>
                  )}
                  {p.comprobante_path && <Comprobante path={p.comprobante_path} />}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {(params?.politica_cancelacion || params?.terminos) && (
        <div className="space-y-2 rounded-2xl border border-gray-200 bg-white p-5 text-xs text-gray-500">
          {params.terminos && <p><span className="font-semibold text-gray-700">Términos: </span>{params.terminos}</p>}
          {params.politica_cancelacion && <p><span className="font-semibold text-gray-700">Cancelación: </span>{params.politica_cancelacion}</p>}
        </div>
      )}
    </div>
  )
}

// ── Bloque de pago ───────────────────────────────────────────────────────────

function PagarCobro({ cobro, metodos, permitirParcial, instrucciones, clienteId, onListo }: {
  cobro: Cobro
  metodos: Metodo[]
  permitirParcial: boolean
  instrucciones: string | null
  clienteId: string
  onListo: () => void
}) {
  const saldo = Number(cobro.saldo)
  const [metodoId, setMetodoId] = useState<string>(metodos[0]?.id ?? '')
  const [monto, setMonto] = useState<string>(String(Math.round(saldo)))
  const [referencia, setReferencia] = useState('')
  const [archivo, setArchivo] = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)

  const metodo = metodos.find((m) => m.id === metodoId) ?? null
  const linkPasarela = cobro.link_pago || metodo?.url_pago || null

  async function reportar() {
    if (!metodo) { toast.error('Selecciona una forma de pago.'); return }
    const valor = Number(monto)
    if (!valor || valor <= 0) { toast.error('Escribe el valor que pagaste.'); return }
    if (valor > saldo) { toast.error('El valor no puede superar el saldo pendiente.'); return }
    if (!permitirParcial && valor < saldo) { toast.error('Debes pagar el saldo completo.'); return }
    if (metodo.requiere_referencia && !referencia.trim()) { toast.error('Escribe el número de referencia de la transacción.'); return }
    if (metodo.requiere_comprobante && !archivo) { toast.error('Adjunta el comprobante del pago.'); return }

    setEnviando(true)
    try {
      let comprobante_path: string | null = null
      if (archivo) {
        const sb = getPortalSupabase()
        const ext = archivo.name.split('.').pop()?.toLowerCase() ?? 'jpg'
        comprobante_path = `${clienteId}/${cobro.id}/${Date.now()}.${ext}`
        const { error } = await sb.storage.from('comprobantes-pago').upload(comprobante_path, archivo, { upsert: false })
        if (error) throw new Error('No pudimos subir el comprobante. Intenta con otro archivo.')
      }

      const token = await tokenActual()
      const res = await fetch('/api/portal/pagos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          cobro_id: cobro.id,
          metodo_id: metodo.id,
          monto: valor,
          referencia: referencia.trim() || null,
          comprobante_path,
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error ?? 'No pudimos registrar tu pago.')

      toast.success('¡Pago reportado! Lo verificamos y te avisamos.')
      setArchivo(null); setReferencia('')
      onListo()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ocurrió un error.')
    } finally {
      setEnviando(false)
    }
  }

  if (metodos.length === 0) {
    return (
      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
        Todavía no hay formas de pago habilitadas. Escríbenos y te indicamos cómo pagar.
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6">
      <h2 className="font-heading text-lg font-bold text-gray-900">Pagar {fmtMoneda(saldo)}</h2>
      {instrucciones && <p className="mt-1 text-sm text-gray-500">{instrucciones}</p>}

      {/* Formas de pago */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {metodos.map((m) => (
          <button
            key={m.id}
            onClick={() => setMetodoId(m.id)}
            className={`flex items-center gap-3 rounded-xl border-2 p-3.5 text-left transition-all ${
              metodoId === m.id ? 'border-brand-green bg-green-50' : 'border-gray-200 hover:border-green-300'
            }`}
          >
            <span className="text-2xl">{m.icono ?? '💳'}</span>
            <span className="min-w-0">
              <span className="block truncate font-semibold text-gray-800">{m.nombre}</span>
              {m.entidad && <span className="block truncate text-xs text-gray-400">{m.entidad}</span>}
            </span>
          </button>
        ))}
      </div>

      {/* Datos e instrucciones del método elegido */}
      {metodo && (
        <div className="mt-4 space-y-3 rounded-xl bg-gray-50 p-4">
          {metodo.instrucciones && <p className="text-sm text-gray-600">{metodo.instrucciones}</p>}
          {metodo.numero_cuenta && (
            <CopiableCuenta
              etiqueta={[metodo.entidad, metodo.tipo_cuenta].filter(Boolean).join(' · ') || 'Cuenta'}
              valor={metodo.numero_cuenta}
              titular={metodo.titular}
            />
          )}
          {linkPasarela && metodo.tipo === 'PASARELA' && (
            <a
              href={linkPasarela}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark"
            >
              <ExternalLink className="h-4 w-4" /> Pagar en línea
            </a>
          )}
          {metodo.tipo === 'EFECTIVO' && (
            <p className="text-xs text-gray-500">
              Este pago lo registra el personal cuando recibe el efectivo; no necesitas reportarlo aquí.
            </p>
          )}
        </div>
      )}

      {/* Reportar el pago */}
      {metodo && metodo.tipo !== 'EFECTIVO' && (
        <div className="mt-5 space-y-3 border-t border-gray-100 pt-5">
          <p className="text-sm font-semibold text-gray-700">Reporta tu pago</p>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-gray-500">Valor pagado</span>
            <input
              type="number"
              inputMode="numeric"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              readOnly={!permitirParcial}
              className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 outline-none focus:border-brand-green disabled:bg-gray-50"
            />
            {permitirParcial && <span className="mt-1 block text-xs text-gray-400">Puedes abonar una parte del saldo.</span>}
          </label>

          {metodo.requiere_referencia && (
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-gray-500">Número de referencia / comprobante</span>
              <input
                value={referencia}
                onChange={(e) => setReferencia(e.target.value)}
                placeholder="Ej. 0012345678"
                className="w-full rounded-xl border border-gray-300 px-3.5 py-2.5 outline-none focus:border-brand-green"
              />
            </label>
          )}

          <label className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-gray-300 px-4 py-3.5 text-sm text-gray-500 hover:border-brand-green hover:bg-green-50/40">
            <Upload className="h-4 w-4 shrink-0 text-brand-green" />
            <span className="min-w-0 flex-1 truncate">
              {archivo ? archivo.name : `Adjuntar comprobante${metodo.requiere_comprobante ? '' : ' (opcional)'}`}
            </span>
            <input
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            />
          </label>

          <button
            onClick={reportar}
            disabled={enviando}
            className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 text-sm font-bold text-white hover:bg-brand-green-dark disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
            Reportar pago
          </button>
        </div>
      )}
    </section>
  )
}

// ── Auxiliares ───────────────────────────────────────────────────────────────

function CopiableCuenta({ etiqueta, valor, titular }: { etiqueta: string; valor: string; titular: string | null }) {
  const [copiado, setCopiado] = useState(false)
  async function copiar() {
    try {
      await navigator.clipboard.writeText(valor)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      toast.error('No se pudo copiar.')
    }
  }
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="text-xs text-gray-400">{etiqueta}</p>
        <p className="truncate font-mono font-semibold text-gray-900">{valor}</p>
        {titular && <p className="truncate text-xs text-gray-400">A nombre de {titular}</p>}
      </div>
      <button onClick={copiar} className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-brand-green" aria-label="Copiar">
        {copiado ? <Check className="h-4 w-4 text-brand-green" /> : <Copy className="h-4 w-4" />}
      </button>
    </div>
  )
}

/** El bucket es privado: se genera un enlace firmado sólo al abrirlo. */
function Comprobante({ path }: { path: string }) {
  const [abriendo, setAbriendo] = useState(false)
  async function abrir() {
    setAbriendo(true)
    const sb = getPortalSupabase()
    const { data, error } = await sb.storage.from('comprobantes-pago').createSignedUrl(path, 300)
    setAbriendo(false)
    if (error || !data?.signedUrl) { toast.error('No se pudo abrir el comprobante.'); return }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }
  return (
    <button onClick={abrir} disabled={abriendo} className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline disabled:opacity-50">
      {abriendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />} Ver comprobante
    </button>
  )
}

function Dato({ label, valor, destacado }: { label: string; valor: string; destacado?: boolean }) {
  return (
    <div className="rounded-xl bg-gray-50 px-4 py-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`font-heading text-lg font-bold ${destacado ? 'text-brand-green' : 'text-gray-900'}`}>{valor}</p>
    </div>
  )
}

function Fila({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex items-center justify-between text-gray-500">
      <span>{label}</span>
      <span className="font-semibold text-gray-700">{valor}</span>
    </div>
  )
}

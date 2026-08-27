'use client'
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, X, Save, Loader2, Search, Receipt, Wallet, AlertTriangle, CheckCircle2,
  XCircle, Send, Ban, Paperclip, FileText, Link2, ChevronDown, Trash2,
} from 'lucide-react'
import {
  crearCobro, emitirCobro, anularCobro, actualizarLinkPago,
  registrarPagoManual, verificarPago, rechazarPago, urlComprobante,
} from '../pagos-actions'

const ESTADOS: Record<string, { label: string; cls: string }> = {
  BORRADOR: { label: 'Borrador', cls: 'bg-gray-100 text-gray-600' },
  EMITIDO:  { label: 'Emitido',  cls: 'bg-yellow-100 text-yellow-700' },
  PARCIAL:  { label: 'Abonado',  cls: 'bg-blue-100 text-blue-700' },
  PAGADO:   { label: 'Pagado',   cls: 'bg-green-100 text-green-700' },
  ANULADO:  { label: 'Anulado',  cls: 'bg-red-100 text-red-700' },
}

const FILTROS = ['TODOS', 'EMITIDO', 'PARCIAL', 'PAGADO', 'BORRADOR', 'ANULADO']

function fmt(v?: number | null) {
  return `$${Number(v ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`
}

function vencido(c: any) {
  return ['EMITIDO', 'PARCIAL'].includes(c.estado)
    && Number(c.saldo) > 0
    && c.fecha_vencimiento
    && c.fecha_vencimiento < new Date().toISOString().split('T')[0]
}

interface Props {
  cobros: any[]
  total: number
  page: number
  pageSize: number
  estado: string
  search: string
  resumen: { porCobrar: number; saldoPendiente: number; vencidos: number; porVerificar: number; recaudado: number }
  porVerificar: any[]
  facturables: any[]
  metodos: any[]
}

export default function PagosClient(props: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [tab, setTab] = useState<'cobros' | 'verificar' | 'sincobrar'>(
    props.porVerificar.length > 0 ? 'verificar' : 'cobros'
  )
  const [busqueda, setBusqueda] = useState(props.search)
  const [nuevoCobro, setNuevoCobro] = useState<any | null>(null)
  const [pagoModal, setPagoModal] = useState<any | null>(null)

  function refrescar() { startTransition(() => router.refresh()) }

  function filtrar(estado: string, search: string) {
    const p = new URLSearchParams()
    if (estado && estado !== 'TODOS') p.set('estado', estado)
    if (search) p.set('search', search)
    router.push(`/servicios-hogar/pagos${p.toString() ? `?${p}` : ''}`)
  }

  const tarjetas = [
    { label: 'Por cobrar',    valor: fmt(props.resumen.saldoPendiente), sub: `${props.resumen.porCobrar} cuenta(s)`, icon: Wallet,        cls: 'text-yellow-600', bg: 'bg-yellow-50' },
    { label: 'Vencidas',      valor: String(props.resumen.vencidos),    sub: 'cuentas sin pagar',                   icon: AlertTriangle, cls: 'text-red-600',    bg: 'bg-red-50' },
    { label: 'Por verificar', valor: String(props.resumen.porVerificar), sub: 'pagos reportados',                    icon: FileText,      cls: 'text-blue-600',   bg: 'bg-blue-50' },
    { label: 'Recaudado',     valor: fmt(props.resumen.recaudado),      sub: 'cuentas pagadas',                     icon: CheckCircle2,  cls: 'text-green-600',  bg: 'bg-green-50' },
  ]

  return (
    <div className="space-y-6">
      {/* Resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {tarjetas.map((t) => {
          const Icon = t.icon
          return (
            <div key={t.label} className={`${t.bg} rounded-2xl p-5`}>
              <div className="w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center mb-3 shadow-sm">
                <Icon className={`w-5 h-5 ${t.cls}`} />
              </div>
              <p className="text-xl font-bold text-gray-900">{t.valor}</p>
              <p className="text-sm text-gray-500">{t.label}</p>
              <p className="text-xs text-gray-400 mt-0.5">{t.sub}</p>
            </div>
          )
        })}
      </div>

      {/* Pestañas */}
      <div className="flex rounded-xl bg-gray-100 p-1">
        {([
          ['cobros', 'Cuentas de cobro', props.total],
          ['verificar', 'Por verificar', props.porVerificar.length],
          ['sincobrar', 'Servicios sin cobrar', props.facturables.length],
        ] as const).map(([id, label, n]) => (
          <button
            key={id}
            onClick={() => setTab(id as typeof tab)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-semibold transition-colors ${
              tab === id ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'
            }`}
          >
            {label}
            {n > 0 && (
              <span className={`rounded-full px-1.5 py-0.5 text-xs font-bold ${tab === id ? 'bg-brand-green text-white' : 'bg-gray-200 text-gray-600'}`}>
                {n}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Cuentas de cobro ── */}
      {tab === 'cobros' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-1 min-w-56 items-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2.5">
              <Search className="w-4 h-4 text-gray-400" />
              <input
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && filtrar(props.estado, busqueda)}
                placeholder="Buscar por número, cliente o correo"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTROS.map((f) => (
                <button
                  key={f}
                  onClick={() => filtrar(f, busqueda)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                    props.estado === f ? 'bg-brand-green text-white border-brand-green' : 'bg-white text-gray-600 border-gray-200 hover:border-green-300'
                  }`}
                >
                  {f === 'TODOS' ? 'Todos' : ESTADOS[f]?.label ?? f}
                </button>
              ))}
            </div>
          </div>

          {props.cobros.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-400">
              No hay cuentas de cobro con este filtro.
            </div>
          ) : (
            <div className="space-y-3">
              {props.cobros.map((c) => (
                <FilaCobro
                  key={c.id}
                  cobro={c}
                  metodos={props.metodos}
                  onPago={() => setPagoModal(c)}
                  onCambio={refrescar}
                />
              ))}
            </div>
          )}

          {props.total > props.pageSize && (
            <Paginacion page={props.page} total={props.total} pageSize={props.pageSize}
              onPage={(p) => {
                const q = new URLSearchParams()
                if (props.estado !== 'TODOS') q.set('estado', props.estado)
                if (props.search) q.set('search', props.search)
                q.set('page', String(p))
                router.push(`/servicios-hogar/pagos?${q}`)
              }} />
          )}
        </div>
      )}

      {/* ── Pagos por verificar ── */}
      {tab === 'verificar' && (
        <div className="space-y-3">
          {props.porVerificar.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-400">
              No hay pagos pendientes de verificación.
            </div>
          ) : (
            props.porVerificar.map((p) => <FilaVerificar key={p.id} pago={p} onCambio={refrescar} />)
          )}
        </div>
      )}

      {/* ── Servicios sin cuenta de cobro ── */}
      {tab === 'sincobrar' && (
        <div className="space-y-3">
          {props.facturables.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-400">
              Todos los servicios confirmados ya tienen cuenta de cobro.
            </div>
          ) : (
            props.facturables.map((s) => (
              <div key={s.id} className="bg-white rounded-2xl border border-gray-100 p-4 flex items-center gap-4">
                <span className="text-2xl">{s.tipos_servicio_hogar?.icono ?? '🏠'}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-gray-900 truncate">{s.cliente_nombre}</span>
                    <span className="text-xs text-gray-400 font-mono shrink-0">{s.numero}</span>
                  </div>
                  <p className="text-xs text-gray-500">
                    {s.tipos_servicio_hogar?.nombre ?? 'Servicio'} · {s.fecha_deseada}
                    {s.tarifas_servicio_hogar?.nombre ? ` · ${s.tarifas_servicio_hogar.nombre}` : ''}
                  </p>
                </div>
                <span className="text-sm font-semibold text-gray-700 shrink-0">
                  {fmt(s.precio_cotizado ?? s.tarifas_servicio_hogar?.precio_unico)}
                </span>
                <button
                  onClick={() => setNuevoCobro(desdeSolicitud(s))}
                  className="shrink-0 flex items-center gap-1.5 bg-brand-green text-white px-3.5 py-2 rounded-lg text-xs font-semibold hover:bg-brand-green-dark"
                >
                  <Plus className="w-3.5 h-3.5" /> Cobrar
                </button>
              </div>
            ))
          )}
        </div>
      )}

      {/* Botón flotante: cuenta de cobro libre */}
      <button
        onClick={() => setNuevoCobro(cobroVacio())}
        className="flex items-center gap-2 bg-brand-green text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green-dark shadow-sm"
      >
        <Plus className="w-4 h-4" /> Nueva cuenta de cobro
      </button>

      {nuevoCobro && (
        <ModalCobro
          inicial={nuevoCobro}
          metodos={props.metodos}
          onCerrar={() => setNuevoCobro(null)}
          onGuardado={() => { setNuevoCobro(null); refrescar() }}
        />
      )}

      {pagoModal && (
        <ModalPago
          cobro={pagoModal}
          metodos={props.metodos}
          onCerrar={() => setPagoModal(null)}
          onGuardado={() => { setPagoModal(null); refrescar() }}
        />
      )}
    </div>
  )
}

// ── Fila de cuenta de cobro ──────────────────────────────────────────────────

function FilaCobro({ cobro, metodos, onPago, onCambio }: {
  cobro: any; metodos: any[]; onPago: () => void; onCambio: () => void
}) {
  const [abierto, setAbierto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const [link, setLink] = useState(cobro.link_pago ?? '')
  const est = ESTADOS[cobro.estado] ?? { label: cobro.estado, cls: 'bg-gray-100 text-gray-600' }
  const pagos = (cobro.pagos_hogar ?? []) as any[]

  async function accion(fn: () => Promise<void>) {
    setOcupado(true)
    try { await fn(); onCambio() }
    catch (e: any) { alert(e?.message ?? 'No se pudo completar la acción.') }
    finally { setOcupado(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button onClick={() => setAbierto((v) => !v)} className="w-full flex items-center gap-4 p-4 text-left">
        <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center shrink-0">
          <Receipt className="w-5 h-5 text-brand-green" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-sm text-gray-900 truncate">{cobro.cliente_nombre ?? 'Cliente'}</span>
            <span className="text-xs text-gray-400 font-mono">{cobro.numero}</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${est.cls}`}>{est.label}</span>
            {vencido(cobro) && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">Vencida</span>
            )}
          </div>
          <p className="text-xs text-gray-500 truncate">
            {cobro.concepto}
            {cobro.solicitudes_servicio_hogar?.numero ? ` · ${cobro.solicitudes_servicio_hogar.numero}` : ''}
            {cobro.fecha_vencimiento ? ` · vence ${cobro.fecha_vencimiento}` : ''}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="font-bold text-gray-900">{fmt(cobro.total)}</p>
          {Number(cobro.saldo) > 0 && <p className="text-xs text-yellow-700">saldo {fmt(cobro.saldo)}</p>}
        </div>
        <ChevronDown className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${abierto ? 'rotate-180' : ''}`} />
      </button>

      {abierto && (
        <div className="border-t border-gray-50 px-4 py-4 space-y-4">
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Dato label="Subtotal" valor={fmt(cobro.subtotal)} />
            <Dato label="Descuento" valor={fmt(cobro.descuento)} />
            <Dato label={`IVA (${Number(cobro.iva_porcentaje)}%)`} valor={fmt(cobro.iva_valor)} />
            <Dato label="Pagado" valor={fmt(cobro.pagado)} />
          </dl>

          {cobro.notas && <p className="text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">{cobro.notas}</p>}

          {pagos.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">Pagos</p>
              <div className="space-y-1.5">
                {pagos.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-3 bg-gray-50 rounded-lg px-3 py-2 text-sm">
                    <span className="text-gray-700">
                      {fmt(p.monto)} · {p.metodo_nombre ?? 'Pago'}{p.referencia ? ` · ref. ${p.referencia}` : ''}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.comprobante_path && <VerComprobante path={p.comprobante_path} />}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                        p.estado === 'VERIFICADO' ? 'bg-green-100 text-green-700'
                        : p.estado === 'RECHAZADO' ? 'bg-red-100 text-red-700'
                        : 'bg-yellow-100 text-yellow-700'
                      }`}>{p.estado}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Link de pasarela */}
          {cobro.estado !== 'ANULADO' && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-1 min-w-56 items-center gap-2 rounded-lg border border-gray-200 px-3 py-2">
                <Link2 className="w-4 h-4 text-gray-400 shrink-0" />
                <input
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="Link de pago de la pasarela (opcional)"
                  className="w-full text-sm outline-none"
                />
              </div>
              <button
                onClick={() => accion(() => actualizarLinkPago(cobro.id, link))}
                disabled={ocupado || link === (cobro.link_pago ?? '')}
                className="px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                Guardar link
              </button>
            </div>
          )}

          {/* Acciones */}
          <div className="flex flex-wrap gap-2">
            {cobro.estado === 'BORRADOR' && (
              <button onClick={() => accion(() => emitirCobro(cobro.id))} disabled={ocupado}
                className="flex items-center gap-1.5 bg-brand-green text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-brand-green-dark disabled:opacity-50">
                <Send className="w-3.5 h-3.5" /> Emitir y avisar al cliente
              </button>
            )}
            {['EMITIDO', 'PARCIAL'].includes(cobro.estado) && (
              <button onClick={onPago}
                className="flex items-center gap-1.5 bg-brand-green text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-brand-green-dark">
                <Wallet className="w-3.5 h-3.5" /> Registrar pago
              </button>
            )}
            {cobro.estado !== 'ANULADO' && cobro.estado !== 'PAGADO' && (
              <button
                onClick={() => {
                  const motivo = prompt('Motivo de la anulación:')
                  if (motivo === null) return
                  accion(() => anularCobro(cobro.id, motivo))
                }}
                disabled={ocupado}
                className="flex items-center gap-1.5 border border-red-200 text-red-600 px-4 py-2 rounded-lg text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
              >
                <Ban className="w-3.5 h-3.5" /> Anular
              </button>
            )}
            {ocupado && <Loader2 className="w-4 h-4 animate-spin text-brand-green" />}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Pago reportado por el cliente ────────────────────────────────────────────

function FilaVerificar({ pago, onCambio }: { pago: any; onCambio: () => void }) {
  const [ocupado, setOcupado] = useState(false)

  async function accion(fn: () => Promise<void>) {
    setOcupado(true)
    try { await fn(); onCambio() }
    catch (e: any) { alert(e?.message ?? 'No se pudo completar la acción.') }
    finally { setOcupado(false) }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-4 flex flex-wrap items-center gap-4">
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
        <FileText className="w-5 h-5 text-blue-600" />
      </div>
      <div className="flex-1 min-w-56">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-gray-900">{fmt(pago.monto)}</span>
          <span className="text-xs text-gray-400 font-mono">{pago.cobros_servicio_hogar?.numero}</span>
        </div>
        <p className="text-xs text-gray-500">
          {pago.cobros_servicio_hogar?.cliente_nombre ?? 'Cliente'} · {pago.metodo_nombre ?? 'Pago'}
          {pago.referencia ? ` · ref. ${pago.referencia}` : ''} · {pago.fecha_pago}
        </p>
        <p className="text-xs text-gray-400">Saldo de la cuenta: {fmt(pago.cobros_servicio_hogar?.saldo)}</p>
      </div>
      {pago.comprobante_path && <VerComprobante path={pago.comprobante_path} />}
      <div className="flex gap-2 shrink-0">
        <button onClick={() => accion(() => verificarPago(pago.id))} disabled={ocupado}
          className="flex items-center gap-1.5 bg-brand-green text-white px-3.5 py-2 rounded-lg text-xs font-semibold hover:bg-brand-green-dark disabled:opacity-50">
          <CheckCircle2 className="w-3.5 h-3.5" /> Verificar
        </button>
        <button
          onClick={() => {
            const motivo = prompt('Motivo del rechazo (lo verá el cliente):')
            if (motivo === null) return
            accion(() => rechazarPago(pago.id, motivo))
          }}
          disabled={ocupado}
          className="flex items-center gap-1.5 border border-red-200 text-red-600 px-3.5 py-2 rounded-lg text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
        >
          <XCircle className="w-3.5 h-3.5" /> Rechazar
        </button>
      </div>
    </div>
  )
}

function VerComprobante({ path }: { path: string }) {
  const [cargando, setCargando] = useState(false)
  async function abrir() {
    setCargando(true)
    const url = await urlComprobante(path).catch(() => null)
    setCargando(false)
    if (!url) { alert('No se pudo abrir el comprobante.'); return }
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  return (
    <button onClick={abrir} disabled={cargando}
      className="flex items-center gap-1.5 text-xs font-semibold text-brand-green hover:underline disabled:opacity-50 shrink-0">
      {cargando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Paperclip className="w-3.5 h-3.5" />} Comprobante
    </button>
  )
}

// ── Modal: nueva cuenta de cobro ─────────────────────────────────────────────

function cobroVacio() {
  return {
    solicitud_id: null, cliente_id: null, cliente_nombre: '', cliente_email: '',
    concepto: 'Servicio del hogar', tipo: 'TOTAL',
    items: [{ descripcion: '', cantidad: 1, valor_unitario: 0 }],
    descuento: 0, fecha_vencimiento: '', link_pago: '', metodo_sugerido: '', notas: '',
    emitir: true,
  }
}

function desdeSolicitud(s: any) {
  const servicio = s.tipos_servicio_hogar?.nombre ?? 'Servicio del hogar'
  const plan = s.tarifas_servicio_hogar?.nombre
  const valor = Number(s.precio_cotizado ?? s.tarifas_servicio_hogar?.precio_unico ?? 0)
  return {
    ...cobroVacio(),
    solicitud_id: s.id,
    cliente_id: s.cliente_id,
    cliente_nombre: s.cliente_nombre ?? '',
    cliente_email: s.cliente_email ?? '',
    concepto: `${servicio}${plan ? ` · ${plan}` : ''}`,
    items: [{
      descripcion: `${servicio}${plan ? ` (${plan})` : ''} — ${s.fecha_deseada}`,
      cantidad: 1,
      valor_unitario: valor,
    }],
  }
}

function ModalCobro({ inicial, metodos, onCerrar, onGuardado }: {
  inicial: any; metodos: any[]; onCerrar: () => void; onGuardado: () => void
}) {
  const [f, setF] = useState<any>(inicial)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  function set(k: string, v: any) { setF((p: any) => ({ ...p, [k]: v })) }
  function setItem(i: number, k: string, v: any) {
    setF((p: any) => ({ ...p, items: p.items.map((it: any, idx: number) => (idx === i ? { ...it, [k]: v } : it)) }))
  }

  const subtotal = f.items.reduce((a: number, i: any) => a + Number(i.cantidad || 1) * Number(i.valor_unitario || 0), 0)

  async function guardar(emitir: boolean) {
    setError(''); setGuardando(true)
    try {
      await crearCobro({
        solicitud_id: f.solicitud_id || null,
        cliente_id: f.cliente_id || null,
        cliente_nombre: f.cliente_nombre || null,
        cliente_email: f.cliente_email || null,
        concepto: f.concepto,
        tipo: f.tipo,
        items: f.items,
        descuento: Number(f.descuento || 0),
        fecha_vencimiento: f.fecha_vencimiento || null,
        link_pago: f.link_pago || null,
        metodo_sugerido: f.metodo_sugerido || null,
        notas: f.notas || null,
        emitir,
      })
      onGuardado()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo crear la cuenta de cobro.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal titulo="Nueva cuenta de cobro" onCerrar={onCerrar}>
      <div className="space-y-4">
        {!f.cliente_id && (
          <div className="rounded-lg bg-yellow-50 px-3 py-2 text-xs text-yellow-800">
            Sin cliente del portal asociado: la cuenta no aparecerá en el portal ni generará aviso automático.
          </div>
        )}

        <div className="grid sm:grid-cols-2 gap-3">
          <Campo label="Cliente">
            <input value={f.cliente_nombre} onChange={(e) => set('cliente_nombre', e.target.value)} className={inputCls} />
          </Campo>
          <Campo label="Correo">
            <input value={f.cliente_email} onChange={(e) => set('cliente_email', e.target.value)} className={inputCls} />
          </Campo>
        </div>

        <Campo label="Concepto">
          <input value={f.concepto} onChange={(e) => set('concepto', e.target.value)} className={inputCls} />
        </Campo>

        <div className="grid sm:grid-cols-2 gap-3">
          <Campo label="Tipo de cobro">
            <select value={f.tipo} onChange={(e) => set('tipo', e.target.value)} className={inputCls}>
              <option value="TOTAL">Total del servicio</option>
              <option value="ANTICIPO">Anticipo</option>
              <option value="SALDO">Saldo</option>
              <option value="ADICIONAL">Adicional</option>
            </select>
          </Campo>
          <Campo label="Vence el (opcional)">
            <input type="date" value={f.fecha_vencimiento} onChange={(e) => set('fecha_vencimiento', e.target.value)} className={inputCls} />
          </Campo>
        </div>

        {/* Ítems */}
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-1.5">Detalle</p>
          <div className="space-y-2">
            {f.items.map((it: any, i: number) => (
              <div key={i} className="flex gap-2">
                <input value={it.descripcion} onChange={(e) => setItem(i, 'descripcion', e.target.value)}
                  placeholder="Descripción" className={`${inputCls} flex-1`} />
                <input type="number" value={it.cantidad} onChange={(e) => setItem(i, 'cantidad', e.target.value)}
                  className={`${inputCls} w-20`} />
                <input type="number" value={it.valor_unitario} onChange={(e) => setItem(i, 'valor_unitario', e.target.value)}
                  placeholder="Valor" className={`${inputCls} w-32`} />
                {f.items.length > 1 && (
                  <button onClick={() => set('items', f.items.filter((_: any, idx: number) => idx !== i))}
                    className="px-2 text-gray-400 hover:text-red-600">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => set('items', [...f.items, { descripcion: '', cantidad: 1, valor_unitario: 0 }])}
            className="mt-2 text-xs font-semibold text-brand-green hover:underline">
            + Agregar ítem
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <Campo label="Descuento">
            <input type="number" value={f.descuento} onChange={(e) => set('descuento', e.target.value)} className={inputCls} />
          </Campo>
          <Campo label="Forma de pago sugerida">
            <select value={f.metodo_sugerido} onChange={(e) => set('metodo_sugerido', e.target.value)} className={inputCls}>
              <option value="">Sin sugerencia</option>
              {metodos.filter((m) => m.activo).map((m) => (
                <option key={m.id} value={m.id}>{m.nombre}</option>
              ))}
            </select>
          </Campo>
        </div>

        <Campo label="Link de pago (pasarela, opcional)">
          <input value={f.link_pago} onChange={(e) => set('link_pago', e.target.value)} placeholder="https://…" className={inputCls} />
        </Campo>

        <Campo label="Notas para el cliente">
          <textarea value={f.notas} onChange={(e) => set('notas', e.target.value)} rows={2} className={inputCls} />
        </Campo>

        <div className="flex items-center justify-between rounded-xl bg-gray-50 px-4 py-3">
          <span className="text-sm text-gray-500">Subtotal</span>
          <span className="font-bold text-gray-900">{fmt(subtotal)}</span>
        </div>
        <p className="text-xs text-gray-400">
          El IVA y el plazo de vencimiento se aplican según la parametrización de pagos.
        </p>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => guardar(true)} disabled={guardando}
            className="flex items-center gap-2 bg-brand-green text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green-dark disabled:opacity-50">
            {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Crear y emitir
          </button>
          <button onClick={() => guardar(false)} disabled={guardando}
            className="flex items-center gap-2 border border-gray-300 px-4 py-2.5 rounded-xl text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
            <Save className="w-4 h-4" /> Guardar como borrador
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Modal: registrar pago manual ─────────────────────────────────────────────

function ModalPago({ cobro, metodos, onCerrar, onGuardado }: {
  cobro: any; metodos: any[]; onCerrar: () => void; onGuardado: () => void
}) {
  const [monto, setMonto] = useState(String(Math.round(Number(cobro.saldo))))
  const [metodoId, setMetodoId] = useState('')
  const [referencia, setReferencia] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    setError(''); setGuardando(true)
    try {
      const m = metodos.find((x) => x.id === metodoId)
      await registrarPagoManual({
        cobro_id: cobro.id,
        metodo_id: metodoId || null,
        metodo_nombre: m?.nombre ?? 'Registrado por el personal',
        monto: Number(monto),
        referencia: referencia || null,
        fecha_pago: fecha,
        notas: notas || null,
      })
      onGuardado()
    } catch (e: any) {
      setError(e?.message ?? 'No se pudo registrar el pago.')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Modal titulo={`Registrar pago · ${cobro.numero}`} onCerrar={onCerrar}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">Saldo pendiente: <span className="font-semibold text-gray-800">{fmt(cobro.saldo)}</span></p>
        <Campo label="Valor recibido">
          <input type="number" value={monto} onChange={(e) => setMonto(e.target.value)} className={inputCls} />
        </Campo>
        <Campo label="Forma de pago">
          <select value={metodoId} onChange={(e) => setMetodoId(e.target.value)} className={inputCls}>
            <option value="">Sin especificar</option>
            {metodos.filter((m) => m.activo).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </Campo>
        <div className="grid sm:grid-cols-2 gap-3">
          <Campo label="Referencia"><input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={inputCls} /></Campo>
          <Campo label="Fecha del pago"><input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={inputCls} /></Campo>
        </div>
        <Campo label="Notas internas"><textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className={inputCls} /></Campo>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button onClick={guardar} disabled={guardando}
          className="flex w-full items-center justify-center gap-2 bg-brand-green text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-brand-green-dark disabled:opacity-50">
          {guardando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Registrar pago
        </button>
      </div>
    </Modal>
  )
}

// ── UI compartida ────────────────────────────────────────────────────────────

const inputCls = 'w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand-green'

function Modal({ titulo, children, onCerrar }: { titulo: string; children: React.ReactNode; onCerrar: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 my-8">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-bold text-gray-900">{titulo}</h2>
          <button onClick={onCerrar} className="p-1 text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-gray-500">{label}</span>
      {children}
    </label>
  )
}

function Dato({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <dt className="text-xs text-gray-400">{label}</dt>
      <dd className="font-semibold text-gray-800">{valor}</dd>
    </div>
  )
}

function Paginacion({ page, total, pageSize, onPage }: {
  page: number; total: number; pageSize: number; onPage: (p: number) => void
}) {
  const paginas = Math.ceil(total / pageSize)
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-400">{total} cuenta(s) · página {page} de {paginas}</span>
      <div className="flex gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)}
          className="px-3 py-1.5 rounded-lg border border-gray-200 font-semibold text-gray-600 disabled:opacity-40">Anterior</button>
        <button disabled={page >= paginas} onClick={() => onPage(page + 1)}
          className="px-3 py-1.5 rounded-lg border border-gray-200 font-semibold text-gray-600 disabled:opacity-40">Siguiente</button>
      </div>
    </div>
  )
}

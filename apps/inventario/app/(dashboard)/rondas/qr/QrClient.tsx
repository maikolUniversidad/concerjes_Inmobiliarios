'use client'

// Emisión e impresión por lotes de los códigos QR de los puntos (F2).
//
// El orden de la pantalla es el orden del trabajo real: se emite el código,
// se mira la vista previa, se imprime, y solo entonces se registra la impresión.
// Mirar un PDF no es imprimir, así que la vista previa no suma al contador: lo
// hace el botón de confirmar, que es el que crea el lote.

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  AlertTriangle, Ban, Eye, Loader2, Printer, QrCode, RefreshCw, ShieldAlert, Search, X, History,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ESTADO_PUNTO, ESTADO_QR, FORMATOS, FORMATOS_LOTE, formatearManual, porHoja, urlDelQr,
  type EstadoPunto, type EstadoQr, type FormatoLote,
} from '@/lib/puntos-qr'
import { armarPdfDeLote, type PlacaDatos } from './placas'
import {
  emitirQr, reemplazarQr, registrarLote, revocarQr,
  type ActionResult, type LoteResult,
} from './actions'

export interface PuntoQr {
  id: string; codigo: string; nombre: string; piso: string | null; estado: EstadoPunto
  sedeId: string; sedeNombre: string; sedeCiudad: string | null; zonaNombre: string | null
  contrato: string; contratoNombre: string; arteColor: string | null
  qrActivo: {
    id: string; version: number; token: string; codigoManual: string
    impresiones: number; firmaLlaveId: string
  } | null
  historial: {
    id: string; version: number; estado: EstadoQr; codigoManual: string
    impresiones: number; creadoEn: string; motivo: string | null
  }[]
}
export interface LoteReciente {
  id: string; numero: string; nombre: string | null; formato: string
  cantidad: number; generadoEn: string; sedeNombre: string
}

const INICIAL: ActionResult = {}
const INICIAL_LOTE: LoteResult = {}
const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'

function Boton({ icono, label }: { icono: React.ReactNode; label: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-60">
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icono}
      {label}
    </button>
  )
}

function useAviso(estado: ActionResult, exito: string) {
  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    else if (estado.ok) toast.success(exito)
  }, [estado, exito])
}

export function QrClient({
  puntos, lotes, llaveLista, llaveId, baseUrl, puedeGestionar,
}: {
  puntos: PuntoQr[]
  lotes: LoteReciente[]
  llaveLista: boolean
  llaveId: string | null
  baseUrl: string
  puedeGestionar: boolean
}) {
  const [sedeFiltro, setSedeFiltro] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [soloSinEmitir, setSoloSinEmitir] = useState(false)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [historialDe, setHistorialDe] = useState<PuntoQr | null>(null)

  const [estEmitir, accEmitir] = useActionState(emitirQr, INICIAL)
  const [estReemplazar, accReemplazar] = useActionState(reemplazarQr, INICIAL)
  const [estRevocar, accRevocar] = useActionState(revocarQr, INICIAL)
  useAviso(estEmitir, 'Código emitido')
  useAviso(estReemplazar, 'Código reemplazado: hay que cambiar la placa en la pared')
  useAviso(estRevocar, 'Código revocado')

  const sedes = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of puntos) if (!m.has(p.sedeId)) m.set(p.sedeId, `${p.contrato} · ${p.sedeNombre}`)
    return [...m].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [puntos])

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    return puntos.filter((p) =>
      (!sedeFiltro || p.sedeId === sedeFiltro)
      && (!soloSinEmitir || !p.qrActivo)
      && p.estado !== 'RETIRADO'
      && (!q || p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q)
          || (p.qrActivo?.codigoManual ?? '').toLowerCase().includes(q)))
  }, [puntos, sedeFiltro, busqueda, soloSinEmitir])

  // Un lote se imprime de UNA sede: el arte es del contrato y las placas se
  // llevan juntas a un sitio. Marcar puntos de dos sedes y mandarlos en un PDF
  // sería un lote que nadie puede repartir.
  const marcadosFila = filtrados.filter((p) => marcados.has(p.id) && p.qrActivo)
  const sedesMarcadas = new Set(marcadosFila.map((p) => p.sedeId))

  const alternar = (id: string) => setMarcados((prev) => {
    const s = new Set(prev)
    if (s.has(id)) s.delete(id); else s.add(id)
    return s
  })
  const marcarTodos = () => setMarcados(new Set(
    filtrados.filter((p) => p.qrActivo).map((p) => p.id),
  ))

  return (
    <div className="space-y-5">
      {!llaveLista && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="font-body text-sm text-amber-800">
            <strong>No hay llave de firma configurada en el servidor</strong>
            {llaveId ? ` (falta el secreto de "${llaveId}")` : ' (falta RONDA_HMAC_LLAVE_ACTUAL)'}.
            Mientras no esté, no se puede emitir ningún código: un QR sin firma verificable es
            una placa que nunca va a abrir. Los códigos ya emitidos siguen funcionando con la
            llave con la que se firmaron.
          </p>
        </div>
      )}

      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[180px] flex-1">
          <label className={etiqueta}>Buscar</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input value={busqueda} onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Punto, código o código manual" className={campo + ' pl-8'} />
          </div>
        </div>
        <div>
          <label className={etiqueta}>Sede</label>
          <select value={sedeFiltro} onChange={(e) => setSedeFiltro(e.target.value)} className={campo}>
            <option value="">Todas las sedes</option>
            {sedes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <label className="flex items-center gap-2 pb-2.5">
          <input type="checkbox" checked={soloSinEmitir}
            onChange={(e) => setSoloSinEmitir(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-brand-green" />
          <span className="font-body text-sm text-gray-700">Solo los que no tienen código</span>
        </label>
      </div>

      {/* Lote */}
      {puedeGestionar && (
        <Lote
          seleccion={marcadosFila}
          variasSedes={sedesMarcadas.size > 1}
          baseUrl={baseUrl}
          limpiar={() => setMarcados(new Set())}
        />
      )}

      {/* Tabla */}
      <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <header className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-4 py-2.5">
          <h2 className="font-heading flex items-center gap-1.5 text-sm font-semibold text-gray-700">
            <QrCode className="h-4 w-4 text-brand-green" /> Puntos y su código
          </h2>
          <div className="flex items-center gap-3">
            {puedeGestionar && filtrados.some((p) => p.qrActivo) && (
              <button onClick={marcarTodos}
                className="font-body text-xs text-gray-500 hover:text-brand-green">
                Marcar los {filtrados.filter((p) => p.qrActivo).length} con código
              </button>
            )}
            <span className="font-body text-xs text-gray-400">{filtrados.length}</span>
          </div>
        </header>

        {filtrados.length === 0 ? (
          <p className="font-body p-4 text-sm text-gray-500">
            No hay puntos con ese filtro. Los puntos se crean en Zonas y puntos.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-white">
                <tr className="font-body text-[11px] uppercase tracking-wide text-gray-500">
                  {puedeGestionar && <th className="w-8 px-4 py-2.5" />}
                  <th className="px-4 py-2.5">Punto</th>
                  <th className="hidden px-4 py-2.5 md:table-cell">Sede y zona</th>
                  <th className="px-4 py-2.5">Código manual</th>
                  <th className="hidden px-4 py-2.5 lg:table-cell">Versión</th>
                  <th className="hidden px-4 py-2.5 lg:table-cell">Impresiones</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtrados.map((p) => (
                  <tr key={p.id}>
                    {puedeGestionar && (
                      <td className="px-4 py-3">
                        <input type="checkbox" disabled={!p.qrActivo}
                          checked={marcados.has(p.id)} onChange={() => alternar(p.id)}
                          className="h-4 w-4 rounded border-gray-300 text-brand-green disabled:opacity-30" />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="font-body text-sm font-semibold text-gray-900">{p.nombre}</p>
                      <p className="font-body text-xs text-gray-400">
                        {p.codigo}
                        {p.estado !== 'ACTIVO' && (
                          <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${ESTADO_PUNTO[p.estado].badge}`}>
                            {ESTADO_PUNTO[p.estado].label}
                          </span>
                        )}
                      </p>
                    </td>
                    <td className="font-body hidden px-4 py-3 text-sm text-gray-600 md:table-cell">
                      {p.sedeNombre}
                      <span className="block text-xs text-gray-400">
                        {[p.zonaNombre, p.piso].filter(Boolean).join(' · ') || 'Sin zona'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.qrActivo ? (
                        <>
                          <span className="font-mono text-sm font-semibold text-brand-green">
                            {formatearManual(p.qrActivo.codigoManual)}
                          </span>
                          <span className="font-body block text-[11px] text-gray-400">
                            firma {p.qrActivo.firmaLlaveId}
                          </span>
                        </>
                      ) : (
                        <span className="font-body text-xs text-gray-400">Sin emitir</span>
                      )}
                    </td>
                    <td className="font-body hidden px-4 py-3 text-sm text-gray-600 lg:table-cell tabular-nums">
                      {p.qrActivo ? `v${p.qrActivo.version}` : '—'}
                      {p.historial.length > 1 && (
                        <span className="block text-[11px] text-gray-400">
                          {p.historial.length} versiones
                        </span>
                      )}
                    </td>
                    <td className="font-body hidden px-4 py-3 text-sm text-gray-600 lg:table-cell tabular-nums">
                      {p.qrActivo ? p.qrActivo.impresiones : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {p.historial.length > 0 && (
                          <button onClick={() => setHistorialDe(p)}
                            className="rounded p-1.5 text-gray-400 hover:bg-gray-50 hover:text-brand-green"
                            title="Ver el historial de versiones">
                            <History className="h-4 w-4" />
                          </button>
                        )}
                        {puedeGestionar && !p.qrActivo && (
                          <form action={accEmitir}>
                            <input type="hidden" name="punto_id" value={p.id} />
                            <fieldset disabled={!llaveLista} className="contents">
                              <Boton icono={<QrCode className="h-3.5 w-3.5" />} label="Emitir" />
                            </fieldset>
                          </form>
                        )}
                        {puedeGestionar && p.qrActivo && (
                          <>
                            <form action={accReemplazar}
                              onSubmit={(e) => {
                                const motivo = window.prompt(
                                  `¿Por qué se reemplaza la placa de "${p.nombre}"? (se guarda en el historial)`,
                                  'placa dañada',
                                )
                                if (motivo === null) { e.preventDefault(); return }
                                const campoMotivo = e.currentTarget.elements.namedItem('motivo')
                                if (campoMotivo instanceof HTMLInputElement) campoMotivo.value = motivo
                              }}>
                              <input type="hidden" name="qr_id" value={p.qrActivo.id} />
                              <input type="hidden" name="punto_id" value={p.id} />
                              <input type="hidden" name="motivo" value="" />
                              <fieldset disabled={!llaveLista} className="contents">
                                <Boton icono={<RefreshCw className="h-3.5 w-3.5" />} label="Reemplazar" />
                              </fieldset>
                            </form>
                            <form action={accRevocar}
                              onSubmit={(e) => {
                                if (!window.confirm(
                                  `Revocar la placa de "${p.nombre}" la deja sin código: nadie podrá abrir ese punto hasta emitir otro. ¿Continuar?`,
                                )) { e.preventDefault() }
                              }}>
                              <input type="hidden" name="qr_id" value={p.qrActivo.id} />
                              <input type="hidden" name="motivo" value="revocado desde la consola" />
                              <Boton icono={<Ban className="h-3.5 w-3.5" />} label="Revocar" />
                            </form>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Lotes recientes */}
      {lotes.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <header className="border-b border-gray-100 bg-gray-50 px-4 py-2.5">
            <h2 className="font-heading flex items-center gap-1.5 text-sm font-semibold text-gray-700">
              <Printer className="h-4 w-4 text-brand-green" /> Últimos lotes impresos
            </h2>
          </header>
          <ul className="divide-y divide-gray-100">
            {lotes.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-x-3 px-4 py-2.5">
                <span className="font-mono text-sm font-semibold text-gray-900">{l.numero}</span>
                <span className="font-body text-sm text-gray-600">
                  {l.cantidad} placas · {FORMATOS[l.formato as FormatoLote]?.label ?? l.formato}
                </span>
                <span className="font-body text-xs text-gray-400">
                  {l.sedeNombre}
                  {l.nombre ? ` · ${l.nombre}` : ''}
                  {' · '}
                  {new Date(l.generadoEn).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {historialDe && (
        <Historial punto={historialDe} baseUrl={baseUrl} cerrar={() => setHistorialDe(null)} />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Lote: vista previa y impresión
// ──────────────────────────────────────────────────────────────────────────────

function Lote({
  seleccion, variasSedes, baseUrl, limpiar,
}: {
  seleccion: PuntoQr[]
  variasSedes: boolean
  baseUrl: string
  limpiar: () => void
}) {
  const [formato, setFormato] = useState<FormatoLote>('HOJA_A4')
  const [nombre, setNombre] = useState('')
  const [previa, setPrevia] = useState<string | null>(null)
  const [armando, setArmando] = useState(false)
  const [estado, accion] = useActionState(registrarLote, INICIAL_LOTE)

  useEffect(() => {
    if (estado.error) toast.error(estado.error)
    else if (estado.ok) {
      toast.success(`Lote ${estado.numero} registrado: ${seleccion.length} placas`)
      limpiar()
      setPrevia(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado])

  // La URL del blob de la vista previa se revoca al cambiarla o al salir: si no,
  // cada previa deja un PDF en memoria del navegador.
  useEffect(() => () => { if (previa) URL.revokeObjectURL(previa) }, [previa])

  const base = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')

  const datos = (): PlacaDatos[] => seleccion.map((p) => ({
    qrId: p.qrActivo!.id,
    token: p.qrActivo!.token,
    codigoManual: p.qrActivo!.codigoManual,
    puntoCodigo: p.codigo,
    puntoNombre: p.nombre,
    sedeNombre: p.sedeNombre,
    zonaPiso: [p.zonaNombre, p.piso].filter(Boolean).join(' · ') || null,
    contratoNombre: p.contratoNombre,
    arteColor: p.arteColor,
  }))

  async function verPrevia() {
    setArmando(true)
    try {
      const pdf = await armarPdfDeLote(datos(), formato, base)
      const url = pdf.output('bloburl') as unknown as string
      if (previa) URL.revokeObjectURL(previa)
      setPrevia(String(url))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo armar el PDF.')
    } finally {
      setArmando(false)
    }
  }

  function imprimir() {
    if (!previa) return
    // Se abre el PDF en una ventana aparte y se deja que el visor del navegador
    // haga el diálogo de impresión: así el usuario ve el papel que va a salir.
    const w = window.open(previa, '_blank')
    if (!w) toast.error('El navegador bloqueó la ventana de impresión. Permite las ventanas emergentes.')
  }

  if (seleccion.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-200 bg-white/60 px-4 py-3">
        <p className="font-body text-sm text-gray-500">
          Marca los puntos cuyas placas quieres imprimir. En cualquier formato el QR sale a
          50 mm o más, que es la medida con la que se lee bien pegado a una pared.
        </p>
      </div>
    )
  }

  const f = FORMATOS[formato]
  const hojas = Math.ceil(seleccion.length / porHoja(formato))

  return (
    <section className="space-y-3 rounded-lg border border-brand-green/30 bg-brand-green-bg/30 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={etiqueta}>Formato</label>
          <select value={formato} onChange={(e) => { setFormato(e.target.value as FormatoLote); setPrevia(null) }}
            className={campo}>
            {FORMATOS_LOTE.map((x) => <option key={x} value={x}>{FORMATOS[x].label}</option>)}
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className={etiqueta}>Nombre del lote (opcional)</label>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)}
            placeholder="Instalación torre A" className={campo} />
        </div>
        <button onClick={verPrevia} disabled={armando || variasSedes}
          className="inline-flex items-center gap-1.5 rounded-lg border border-brand-green bg-white px-3 py-2 font-body text-sm font-semibold text-brand-green hover:bg-brand-green-bg disabled:opacity-50">
          {armando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
          Vista previa
        </button>
      </div>

      <p className="font-body text-sm text-gray-600">
        {seleccion.length} placas · {hojas} {hojas === 1 ? 'hoja' : 'hojas'} · QR de {f.qr} mm
        <span className="block text-xs text-gray-500">{f.detalle}</span>
      </p>

      {variasSedes && (
        <p className="font-body flex items-start gap-1.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          Marcaste puntos de varias sedes. Un lote se imprime de una sola sede: el arte es del
          contrato y las placas se llevan juntas a un sitio. Filtra por sede y vuelve a marcar.
        </p>
      )}

      {previa && !variasSedes && (
        <div className="space-y-2">
          <iframe src={previa} title="Vista previa de las placas"
            className="h-[480px] w-full rounded-lg border border-gray-200 bg-white" />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={imprimir}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 font-body text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Printer className="h-4 w-4" /> Abrir para imprimir
            </button>
            <form action={accion}>
              <input type="hidden" name="sede_id" value={seleccion[0].sedeId} />
              <input type="hidden" name="formato" value={formato} />
              <input type="hidden" name="nombre" value={nombre} />
              <input type="hidden" name="qr_ids" value={seleccion.map((p) => p.qrActivo!.id).join(',')} />
              <ConfirmarImpresion cantidad={seleccion.length} />
            </form>
            <p className="font-body text-xs text-gray-500">
              Registrar crea el lote con su consecutivo y suma una impresión a cada código.
              Hazlo cuando el papel ya haya salido: mirar el PDF no es imprimir.
            </p>
          </div>
        </div>
      )}
    </section>
  )
}

function ConfirmarImpresion({ cantidad }: { cantidad: number }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      Registrar impresión de {cantidad}
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Historial de versiones de un punto
// ──────────────────────────────────────────────────────────────────────────────

function Historial({
  punto, baseUrl, cerrar,
}: { punto: PuntoQr; baseUrl: string; cerrar: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cerrar() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [cerrar])

  const base = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-xl">
        <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <div>
            <h2 className="font-heading text-base font-bold text-gray-900">{punto.nombre}</h2>
            <p className="font-body text-xs text-gray-400">
              {punto.codigo} · {punto.sedeNombre}
            </p>
          </div>
          <button onClick={cerrar} className="rounded p-1 text-gray-400 hover:bg-gray-50">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-3 p-5">
          {punto.qrActivo && (
            <div className="rounded-lg border border-gray-200 p-3">
              <p className={etiqueta}>Lo que hay impreso hoy</p>
              <p className="font-mono mt-1 break-all text-xs text-gray-600">
                {urlDelQr(punto.qrActivo.token, base)}
              </p>
            </div>
          )}
          <ul className="divide-y divide-gray-100">
            {punto.historial.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 py-2.5">
                <span className="font-body w-10 text-sm font-semibold text-gray-700">
                  v{v.version}
                </span>
                <span className={`font-body inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${ESTADO_QR[v.estado].badge}`}>
                  {ESTADO_QR[v.estado].label}
                </span>
                <span className="font-mono text-sm text-gray-700">
                  {formatearManual(v.codigoManual)}
                </span>
                <span className="font-body text-xs text-gray-400">
                  {v.impresiones} impresiones ·{' '}
                  {new Date(v.creadoEn).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}
                  {v.motivo ? ` · ${v.motivo}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="font-body text-xs text-gray-500">
            Las versiones no se borran: una placa que alguien fotografió antes del cambio se
            tiene que poder rechazar, y para eso su fila tiene que seguir ahí.
          </p>
        </div>
      </div>
    </div>
  )
}

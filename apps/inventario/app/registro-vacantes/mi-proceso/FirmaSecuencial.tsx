'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, PenLine, X } from 'lucide-react'
import { toast } from 'sonner'
import { getSupabase } from '@/lib/supabase/anon'
import { htmlParaMostrar } from '@/lib/documentos/html'
import { VisorDocumento } from '@/components/documentos/VisorDocumento'
import { PadFirma } from '@/components/firma/PadFirma'
import { siguientePendiente, resumenFirma, retomarOmitidos, type EstadoFirma } from '@/lib/ats/firma-secuencial'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DocPorFirmar { id: string; nombre: string }

const CAMPOS = 'id, nombre, html_render, html_firmado, firma_evidencia, sha256, estado'

/**
 * Firma de los documentos del candidato uno tras otro, pensada para el celular:
 * el documento ocupa la pantalla y abajo queda solo lo necesario para
 * confirmarlo y firmarlo («Firmar y seguir»). La firma se dibuja una vez y se
 * usa en cada documento que el candidato confirma; cada documento se confirma
 * por separado y su firma queda con su propia evidencia (fecha, IP, equipo).
 */
export function FirmaSecuencial({ docs, inicial = 0, fotoUrl, onCerrar }: {
  /** Solo los que se firman electrónicamente, en el orden en que se muestran. */
  docs: DocPorFirmar[]
  inicial?: number
  fotoUrl: string | null
  onCerrar: () => void
}) {
  const sb = useMemo(() => getSupabase(), [])
  const [i, setI] = useState(() => Math.min(Math.max(0, inicial), docs.length - 1))
  const [estados, setEstados] = useState<EstadoFirma[]>(() => docs.map(() => 'pendiente'))
  const [cuerpos, setCuerpos] = useState<Record<string, string>>({})
  const [fallidos, setFallidos] = useState<Record<string, boolean>>({})
  const [leido, setLeido] = useState(false)
  const [firma, setFirma] = useState<string | null>(null)
  const [hoja, setHoja] = useState<null | { firmarAlUsar: boolean }>(null)
  const [trazo, setTrazo] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [terminado, setTerminado] = useState(false)
  const cuerpoRef = useRef<HTMLDivElement>(null)
  const pedidos = useRef(new Set<string>())

  const cargar = useCallback(async (id: string) => {
    if (pedidos.current.has(id)) return
    pedidos.current.add(id)
    const { data, error } = await sb.from('documentos_generados').select(CAMPOS).eq('id', id).single()
    if (error || !data) {
      pedidos.current.delete(id)
      setFallidos((f) => ({ ...f, [id]: true }))
      return
    }
    // Si ya lo firmó (en otra pestaña, por ejemplo), se muestra como firmado.
    if ((data as any).estado !== 'PENDIENTE_FIRMA') {
      setEstados((prev) => prev.map((e, k) => (docs[k].id === id ? 'firmado' : e)))
    }
    setCuerpos((m) => ({ ...m, [id]: htmlParaMostrar(data as any, { fotoUrl }) }))
  }, [sb, fotoUrl, docs])

  const actual = docs[i]

  useEffect(() => {
    if (!actual) return
    void cargar(actual.id)
    // Mientras lee este se trae el siguiente, para que «Firmar y seguir» sea inmediato.
    const j = siguientePendiente(estados.map((e, k) => (k === i ? 'firmado' : e)), i)
    if (j >= 0) void cargar(docs[j].id)
  }, [actual, i, docs, estados, cargar])

  // Cada documento se confirma por separado y se empieza a leer desde arriba.
  useEffect(() => {
    setLeido(false)
    cuerpoRef.current?.scrollTo({ top: 0 })
  }, [i])

  // La página de atrás no se mueve mientras se firma.
  useEffect(() => {
    const previo = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previo }
  }, [])

  function irAlSiguiente(lista: EstadoFirma[]) {
    const j = siguientePendiente(lista, i)
    if (j < 0) setTerminado(true)
    else setI(j)
  }

  async function firmarCon(dataUrl: string) {
    if (!actual) return
    setEnviando(true)
    const { data, error } = await sb.rpc('vac_firmar_documento', {
      p_doc: actual.id, p_firma_data_url: dataUrl, p_user_agent: navigator.userAgent,
    })
    setEnviando(false)
    if (error) { toast.error(error.message); return }
    if (data) setCuerpos((m) => ({ ...m, [actual.id]: htmlParaMostrar(data as any, { fotoUrl }) }))
    const nuevos = estados.map((e, k) => (k === i ? 'firmado' : e))
    setEstados(nuevos)
    irAlSiguiente(nuevos)
  }

  function despues() {
    const nuevos = estados.map((e, k) => (k === i && e === 'pendiente' ? 'omitido' : e))
    setEstados(nuevos)
    irAlSiguiente(nuevos)
  }

  function firmarActual() {
    if (!leido || enviando) return
    if (!firma) { setTrazo(null); setHoja({ firmarAlUsar: true }); return }
    void firmarCon(firma)
  }

  async function usarTrazo() {
    if (!trazo || !hoja) return
    const firmarYa = hoja.firmarAlUsar
    setFirma(trazo)
    setHoja(null)
    if (firmarYa) await firmarCon(trazo)
  }

  function retomar() {
    const nuevos = retomarOmitidos(estados)
    setEstados(nuevos)
    setTerminado(false)
    setI(Math.max(0, siguientePendiente(nuevos, -1)))
  }

  function irA(k: number) {
    setTerminado(false)
    setI(Math.min(Math.max(0, k), docs.length - 1))
  }

  if (!actual) return null
  const r = resumenFirma(estados)
  const firmadoActual = estados[i] === 'firmado'
  const quedanOtros = estados.some((e, k) => k !== i && e === 'pendiente')

  // En el body: cubre toda la pantalla sin heredar márgenes ni posiciones de la página.
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-white" role="dialog" aria-modal="true" aria-label="Firma de documentos">
      {/* Encabezado: qué documento es y cuánto falta */}
      <div className="border-b border-gray-100 bg-white">
        <div className="flex items-center gap-1 px-2 pt-2">
          <button type="button" onClick={onCerrar} className="rounded-lg p-2 text-gray-500 hover:bg-gray-100" aria-label="Cerrar">
            <X className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              {terminado ? 'Resumen' : `Documento ${i + 1} de ${docs.length}`}
            </p>
            <p className="truncate font-heading text-[15px] font-bold leading-tight text-gray-900">
              {terminado ? 'Firma de documentos' : actual.nombre}
            </p>
          </div>
          {!terminado && docs.length > 1 && (
            <>
              <button type="button" onClick={() => irA(i - 1)} disabled={i === 0} aria-label="Documento anterior"
                className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-30">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => irA(i + 1)} disabled={i === docs.length - 1} aria-label="Documento siguiente"
                className="rounded-lg p-2 text-gray-600 hover:bg-gray-100 disabled:opacity-30">
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
        <div className="flex gap-1 px-3 pb-1.5 pt-1">
          {docs.map((d, k) => (
            <button key={d.id} type="button" onClick={() => irA(k)} title={d.nombre}
              aria-label={`${d.nombre}: ${estados[k] === 'firmado' ? 'firmado' : estados[k] === 'omitido' ? 'para después' : 'por firmar'}`}
              className="flex-1 py-1.5">
              <span className={'block h-1.5 rounded-full ' + (
                estados[k] === 'firmado' ? 'bg-brand-green'
                  : !terminado && k === i ? 'bg-brand-green/35 ring-1 ring-brand-green'
                    : estados[k] === 'omitido' ? 'bg-amber-300' : 'bg-gray-200')} />
            </button>
          ))}
        </div>
      </div>

      {terminado ? (
        <div className="flex flex-1 flex-col items-center overflow-y-auto px-5 py-8 text-center">
          <div className={'flex h-16 w-16 items-center justify-center rounded-full ' + (r.omitidos ? 'bg-amber-100' : 'bg-green-100')}>
            {r.omitidos ? <Clock className="h-8 w-8 text-amber-600" /> : <Check className="h-8 w-8 text-green-600" />}
          </div>
          <p className="mt-4 font-heading text-xl font-bold text-gray-900">
            {r.omitidos ? `Firmaste ${r.firmados} de ${r.total}` : r.total === 1 ? '¡Listo! Documento firmado' : '¡Listo! Firmaste todos tus documentos'}
          </p>
          <p className="mt-1 max-w-sm text-sm text-gray-500">
            {r.omitidos
              ? `Dejaste ${r.omitidos === 1 ? 'uno' : r.omitidos} para después. Puedes firmarlo${r.omitidos === 1 ? '' : 's'} ahora o cuando quieras desde Mi proceso.`
              : 'Recursos Humanos ya los tiene. Te avisaremos por correo los siguientes pasos.'}
          </p>
          <ul className="mt-5 w-full max-w-sm space-y-1.5 text-left">
            {docs.map((d, k) => (
              <li key={d.id} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {estados[k] === 'firmado'
                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                  : <Clock className="h-4 w-4 shrink-0 text-amber-500" />}
                <span className="min-w-0 flex-1 truncate">{d.nombre}</span>
              </li>
            ))}
          </ul>
          <div className="mt-6 flex w-full max-w-sm flex-col gap-2">
            {r.omitidos > 0 && (
              <button type="button" onClick={retomar}
                className="flex items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-semibold text-white hover:bg-brand-green-dark">
                <PenLine className="h-5 w-5" /> Firmar los que dejé para después
              </button>
            )}
            <button type="button" onClick={onCerrar}
              className={r.omitidos
                ? 'rounded-xl border border-gray-200 py-3 font-semibold text-gray-700 hover:bg-gray-50'
                : 'rounded-xl bg-brand-green py-3 font-semibold text-white hover:bg-brand-green-dark'}>
              Volver a mi proceso
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* El documento ocupa la pantalla */}
          <div ref={cuerpoRef} className="flex-1 overflow-y-auto overscroll-contain bg-gray-50 p-1.5 sm:p-4">
            <div className="mx-auto max-w-4xl">
              {cuerpos[actual.id] ? (
                <VisorDocumento cuerpo={cuerpos[actual.id]} titulo={actual.nombre} alturaMax="none" mostrarImprimir={false} vistaInicial="lectura" />
              ) : fallidos[actual.id] ? (
                <div className="flex flex-col items-center gap-3 py-20 text-center text-sm text-gray-600">
                  <AlertTriangle className="h-8 w-8 text-amber-500" />
                  No se pudo abrir el documento. Revisa tu conexión.
                  <button type="button" onClick={() => { setFallidos((f) => ({ ...f, [actual.id]: false })); void cargar(actual.id) }}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 font-semibold text-gray-700">
                    Reintentar
                  </button>
                </div>
              ) : (
                <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-brand-green" /></div>
              )}
            </div>
          </div>

          {/* Abajo, solo lo necesario para firmar este documento */}
          <div className="border-t border-gray-200 bg-white px-3 pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="mx-auto max-w-xl space-y-2.5">
              {firmadoActual ? (
                <div className="flex items-center gap-2">
                  <p className="flex flex-1 items-center gap-1.5 text-sm font-semibold text-green-700">
                    <CheckCircle2 className="h-5 w-5" /> Ya firmaste este documento
                  </p>
                  <button type="button" onClick={() => irAlSiguiente(estados)}
                    className="inline-flex items-center gap-1 rounded-xl bg-brand-green px-4 py-3 text-sm font-semibold text-white hover:bg-brand-green-dark">
                    {quedanOtros ? 'Siguiente' : 'Terminar'} <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <>
                  <label className="flex items-start gap-2.5 text-sm leading-snug text-gray-700">
                    <input type="checkbox" checked={leido} onChange={(e) => setLeido(e.target.checked)} disabled={!cuerpos[actual.id]}
                      className="mt-0.5 h-5 w-5 shrink-0 accent-[#2E7D32]" />
                    Leí este documento, mis datos están bien y estoy de acuerdo con su contenido.
                  </label>
                  {firma && (
                    <div className="flex items-center gap-3 rounded-xl border border-gray-200 px-3 py-1">
                      <span className="text-xs text-gray-500">Tu firma</span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={firma} alt="Tu firma" className="h-9 max-w-[45%] object-contain" />
                      <button type="button" onClick={() => { setTrazo(null); setHoja({ firmarAlUsar: false }) }}
                        className="ml-auto py-2 text-xs font-semibold text-brand-green">
                        Cambiar
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {docs.length > 1 && (
                      <button type="button" onClick={despues} disabled={enviando}
                        className="rounded-xl border border-gray-200 px-4 py-3 text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                        Después
                      </button>
                    )}
                    <button type="button" onClick={firmarActual} disabled={!leido || enviando}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
                      {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <PenLine className="h-5 w-5" />}
                      {!firma ? 'Firmar' : quedanOtros ? 'Firmar y seguir' : 'Firmar y terminar'}
                    </button>
                  </div>
                  <p className="text-center text-[11px] leading-snug text-gray-400">
                    Firma electrónica (Ley 527 de 1999): queda con la fecha, la hora y el equipo desde donde firmas.
                  </p>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/* Hoja para dibujar la firma (una sola vez) */}
      {hoja && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/40 sm:items-center">
          <div className="w-full max-w-lg rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:rounded-2xl">
            <div className="flex items-center justify-between">
              <p className="font-heading text-lg font-bold text-gray-900">{firma ? 'Cambiar mi firma' : 'Dibuja tu firma'}</p>
              <button type="button" onClick={() => setHoja(null)} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mb-3 mt-0.5 text-xs text-gray-500">
              Fírmala como en tu cédula. La usamos en cada documento que confirmes y la puedes cambiar cuando quieras.
            </p>
            <PadFirma onCambio={setTrazo} alto={200} />
            <button type="button" onClick={usarTrazo} disabled={!trazo || enviando}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
              {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
              {hoja.firmarAlUsar ? (quedanOtros ? 'Firmar y seguir' : 'Firmar') : 'Usar esta firma'}
            </button>
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

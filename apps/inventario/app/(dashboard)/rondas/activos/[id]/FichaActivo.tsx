'use client'

// Ficha del activo del cliente (F6). Cuatro bloques, en el orden en que se
// usan en sitio: quién es, su placa, sus documentos y sus medidores.
//
// Los ARCHIVOS se suben DIRECTO al bucket desde aquí (mismo patrón de
// /rondas/instructivos y de /gestion-humana/plantillas): por una server action
// pasaría todo el binario y el límite de cuerpo es de 4,5 MB. Leerlos necesita
// una URL firmada que caduca en 300 segundos, así que se pide en el momento de
// abrirla y nunca se guarda.
//
// Todo lo demás (medidores, lecturas, placa) va por server action, porque el
// token de la placa lo firma el servidor con la llave HMAC del ADR-B y las
// lecturas tienen reglas que la base tiene que poder exigir.

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormStatus } from 'react-dom'
import {
  AlertTriangle, Cog, Download, Eye, FileText, Gauge, Loader2, Plus, Printer,
  QrCode, Save, Trash2, Upload, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import {
  CRITICIDAD, ESTADO_ACTIVO, ORIGEN_LECTURA, TIPOS_DOCUMENTO_ACTIVO,
  TIPOS_MEDIDOR, TIPO_DOCUMENTO_ACTIVO, TIPO_MEDIDOR,
  acumulativoPorDefecto, estadoGarantia, medidorEnAlerta, rutaArchivoActivo,
  tamanoCorto, valorMedidor,
  type Criticidad, type EstadoActivo, type OrigenLectura,
  type TipoDocumentoActivo, type TipoMedidor,
} from '@/lib/activos'
import { ESTADO_QR, FORMATOS, FORMATOS_LOTE, formatearManual, urlDelQr, type FormatoLote, type EstadoQr } from '@/lib/puntos-qr'
import { armarPdfDeLote } from '../../qr/placas'
import {
  eliminarDocumentoActivo, eliminarLectura, eliminarMedidor, emitirQrActivo,
  guardarDocumentoActivo, guardarMedidor, registrarImpresionActivo,
  registrarLectura, revocarQrActivo, type ActionResult,
} from '../actions'

export interface DocumentoFila {
  id: string
  tipo: TipoDocumentoActivo
  nombre: string
  nombreArchivo: string | null
  archivoPath: string
  mime: string | null
  tamano: number | null
  venceAt: string | null
  notas: string | null
  createdAt: string
}
export interface MedidorFila {
  id: string
  codigo: string
  nombre: string
  tipo: TipoMedidor
  unidad: string
  valorActual: number
  leidoAt: string | null
  acumulativo: boolean
  decimales: number
  valorAlerta: number | null
  activo: boolean
}
export interface LecturaFila {
  id: string
  medidorId: string
  valor: number
  valorAnterior: number | null
  delta: number | null
  leidoAt: string
  origen: OrigenLectura
  nota: string | null
}
export interface QrFila {
  id: string
  version: number
  token: string
  codigoManual: string
  estado: EstadoQr
  motivoCambio: string | null
  impresiones: number
  createdAt: string
}
export interface ActivoFicha {
  id: string
  codigo: string
  clavePublica: string
  nombre: string
  descripcion: string | null
  marca: string | null
  modelo: string | null
  serial: string | null
  ubicacionTexto: string | null
  piso: string | null
  fechaInstalacion: string | null
  garantiaHasta: string | null
  criticidad: Criticidad
  estado: EstadoActivo
  enUso: boolean
  observaciones: string | null
  sedeNombre: string
  sedeCiudad: string | null
  sedeDireccion: string | null
  zonaNombre: string | null
  puntoId: string | null
  puntoCodigo: string | null
  puntoNombre: string | null
  tipoNombre: string | null
  tipoExigeMedidor: boolean
  tipoMedidor: TipoMedidor | null
  tipoMedidorUnidad: string | null
  tipoNormativa: string | null
  proveedorNombre: string | null
  padre: { id: string; codigo: string; nombre: string } | null
  contratoCodigo: string
  contratoNombre: string
  contratoEstado: string | null
  arteColor: string | null
}

const INICIAL: ActionResult = {}
const campo = 'w-full rounded-lg border border-gray-200 px-3 py-2 font-body text-sm focus:border-brand-green focus:outline-none disabled:bg-gray-50 disabled:text-gray-500'
const etiqueta = 'font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400'
const tarjeta = 'rounded-lg border border-gray-200 bg-white p-4 sm:p-5'

function Guardar({ label = 'Guardar' }: { label?: string }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-60">
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
      {label}
    </button>
  )
}

/** Fecha y hora en `America/Bogota`, fija: con la del navegador la página que
 *  el servidor pinta y la que el navegador rehace no coinciden y React avisa de
 *  un error de hidratación. Es la misma trampa que ya documentó /soporte. */
function fechaHora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-CO', {
    timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function FichaActivo({
  activo, hijos, documentos, medidores, lecturas, qrs,
  baseUrl, llaveLista, llaveId, puedeGestionar, puedeLeer, puedeQr,
}: {
  activo: ActivoFicha
  hijos: { id: string; codigo: string; nombre: string; estado: EstadoActivo }[]
  documentos: DocumentoFila[]
  medidores: MedidorFila[]
  lecturas: LecturaFila[]
  qrs: QrFila[]
  baseUrl: string
  llaveLista: boolean
  llaveId: string | null
  puedeGestionar: boolean
  puedeLeer: boolean
  puedeQr: boolean
}) {
  const router = useRouter()
  const sb = createClient()
  const [, pendiente] = useTransition()

  const [estadoMedidor, accionMedidor] = useActionState(guardarMedidor, INICIAL)
  const [estadoLectura, accionLectura] = useActionState(registrarLectura, INICIAL)
  const [estadoDoc, accionDoc] = useActionState(guardarDocumentoActivo, INICIAL)
  const [estadoQr, accionQr] = useActionState(emitirQrActivo, INICIAL)

  const [medidorEditando, setMedidorEditando] = useState<MedidorFila | null>(null)
  const [medidorNuevo, setMedidorNuevo] = useState(false)
  const [tipoMedidorForm, setTipoMedidorForm] = useState<TipoMedidor>(activo.tipoMedidor ?? 'HORAS')
  const [lecturaDe, setLecturaDe] = useState<MedidorFila | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const [archivo, setArchivo] = useState<{ path: string; nombre: string; mime: string; tamano: number } | null>(null)
  const [formato, setFormato] = useState<FormatoLote>('PLACA_A6')
  const archivoRef = useRef<HTMLInputElement>(null)

  const qrActivo = qrs.find((q) => q.estado === 'ACTIVO') ?? null
  const gar = estadoGarantia(activo.garantiaHasta)
  const base = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '')

  useEffect(() => {
    if (estadoMedidor.error) toast.error(estadoMedidor.error)
    else if (estadoMedidor.ok) {
      toast.success('Medidor guardado'); setMedidorEditando(null); setMedidorNuevo(false)
    }
  }, [estadoMedidor])
  useEffect(() => {
    if (estadoLectura.error) toast.error(estadoLectura.error)
    else if (estadoLectura.ok) { toast.success('Lectura registrada'); setLecturaDe(null) }
  }, [estadoLectura])
  useEffect(() => {
    if (estadoDoc.error) toast.error(estadoDoc.error)
    else if (estadoDoc.ok) {
      toast.success('Documento guardado')
      setArchivo(null)
      if (archivoRef.current) archivoRef.current.value = ''
    }
  }, [estadoDoc])
  useEffect(() => {
    if (estadoQr.error) toast.error(estadoQr.error)
    else if (estadoQr.ok) toast.success('Placa emitida. Ya se puede imprimir.')
  }, [estadoQr])

  const lecturasPorMedidor = useMemo(() => {
    const m = new Map<string, LecturaFila[]>()
    for (const l of lecturas) {
      const lista = m.get(l.medidorId) ?? []
      lista.push(l)
      m.set(l.medidorId, lista)
    }
    return m
  }, [lecturas])

  /** Sube el archivo a `activos/<id>/…`. La política de storage
   *  `activo_archivo_puede_subir()` rechaza cualquier otra carpeta. */
  async function subir(file: File) {
    setSubiendo(true)
    const path = rutaArchivoActivo(activo.id, file.name)
    const up = await sb.storage.from('rondas')
      .upload(path, file, { upsert: false, contentType: file.type || undefined })
    setSubiendo(false)
    if (up.error) {
      toast.error(up.error.message.includes('row-level security') || up.error.message.includes('Unauthorized')
        ? 'La base no te deja subir a la carpeta de este activo.'
        : up.error.message)
      return
    }
    setArchivo({ path, nombre: file.name, mime: file.type || '', tamano: file.size })
    toast.success('Archivo subido. Ponle nombre y guárdalo.')
  }

  /** Abre el archivo con una URL firmada de 300 s, como manda el ADR-C. */
  async function ver(d: DocumentoFila) {
    const { data, error } = await sb.storage.from('rondas').createSignedUrl(d.archivoPath, 300)
    if (error || !data?.signedUrl) { toast.error('No se pudo abrir el archivo.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  function borrarDoc(d: DocumentoFila) {
    if (!confirm(`¿Borrar "${d.nombre}"? También se borra el archivo del bucket.`)) return
    pendiente(async () => {
      const r = await eliminarDocumentoActivo(d.id, activo.id)
      if (r.error) toast.error(r.error)
      else { toast.success('Documento borrado'); router.refresh() }
    })
  }
  function borrarMed(m: MedidorFila) {
    if (!confirm(`¿Borrar el medidor "${m.nombre}"? Se borran también sus lecturas.`)) return
    pendiente(async () => {
      const r = await eliminarMedidor(m.id, activo.id)
      if (r.error) toast.error(r.error)
      else { toast.success('Medidor borrado'); router.refresh() }
    })
  }
  function borrarLec(l: LecturaFila) {
    if (!confirm('¿Borrar esta lectura? El valor del medidor se recalcula con la que quede. Una lectura no se edita: se borra y se vuelve a tomar.')) return
    pendiente(async () => {
      const r = await eliminarLectura(l.id, activo.id)
      if (r.error) toast.error(r.error)
      else { toast.success('Lectura borrada'); router.refresh() }
    })
  }
  function revocar() {
    if (!qrActivo) return
    const motivo = prompt('¿Por qué se revoca la placa? (queda en el histórico)')
    if (!motivo) return
    pendiente(async () => {
      const r = await revocarQrActivo(qrActivo.id, activo.id, motivo)
      if (r.error) toast.error(r.error)
      else { toast.success('Placa revocada'); router.refresh() }
    })
  }

  /** Arma el PDF de la placa y abre el diálogo de impresión. Armar el PDF no
   *  cuenta como imprimir: la impresión se registra al confirmar. */
  async function imprimir() {
    if (!qrActivo) return
    try {
      const pdf = await armarPdfDeLote([{
        qrId: qrActivo.id,
        token: qrActivo.token,
        codigoManual: qrActivo.codigoManual,
        // La placa de un activo lleva su código y su nombre donde la del punto
        // lleva los del punto: el formato del arte es el mismo y no hace falta
        // un segundo generador de PDF.
        puntoCodigo: activo.codigo,
        puntoNombre: activo.nombre,
        sedeNombre: activo.sedeNombre,
        zonaPiso: [activo.zonaNombre, activo.piso, activo.ubicacionTexto]
          .filter(Boolean).join(' · ') || null,
        contratoNombre: activo.contratoNombre,
        arteColor: activo.arteColor,
      }], formato, base)
      pdf.autoPrint()
      const url = pdf.output('bloburl')
      window.open(url, '_blank', 'noopener')
      const r = await registrarImpresionActivo(qrActivo.id, formato, activo.id)
      if (r.error) toast.error(r.error)
      else router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo armar la placa.')
    }
  }

  return (
    <div className="space-y-5">
      {/* ── Encabezado ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-body text-[11px] uppercase tracking-wide text-gray-400">
            {activo.contratoCodigo} · {activo.sedeNombre}
          </p>
          <h1 className="font-heading flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Cog className="h-6 w-6 text-brand-green" /> {activo.nombre}
          </h1>
          <p className="font-body mt-0.5 text-sm text-gray-500">
            <span className="font-mono">{activo.codigo}</span>
            {activo.tipoNombre && <> · {activo.tipoNombre}</>}
            {[activo.marca, activo.modelo].filter(Boolean).length > 0 && (
              <> · {[activo.marca, activo.modelo].filter(Boolean).join(' ')}</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-2 py-1 font-body text-xs font-semibold ${ESTADO_ACTIVO[activo.estado].badge}`}>
            {ESTADO_ACTIVO[activo.estado].label}
          </span>
          <span className={`rounded px-2 py-1 font-body text-xs font-semibold ${CRITICIDAD[activo.criticidad].badge}`}>
            Criticidad {CRITICIDAD[activo.criticidad].label.toLowerCase()}
          </span>
          {gar && (
            <span className={`rounded px-2 py-1 font-body text-xs ${gar.badge}`}>{gar.texto}</span>
          )}
          {!activo.enUso && (
            <span className="rounded bg-gray-200 px-2 py-1 font-body text-xs text-gray-600">Fuera de uso</span>
          )}
        </div>
      </div>

      {activo.tipoNormativa && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="font-body text-sm text-amber-800">
            El mantenimiento de este tipo de activo lo exige una norma: {activo.tipoNormativa}.
            El plan preventivo que lo cumpla se programa en el módulo de mantenimiento.
          </p>
        </div>
      )}

      {/* ── Datos ────────────────────────────────────────────────────────── */}
      <div className={tarjeta}>
        <h2 className="font-heading mb-3 font-semibold text-gray-900">Dónde está y qué es</h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dato titulo="Sede">
            {activo.sedeNombre}
            {activo.sedeDireccion && <span className="block text-xs text-gray-500">{activo.sedeDireccion}</span>}
          </Dato>
          <Dato titulo="Lugar">
            {[activo.zonaNombre, activo.piso, activo.ubicacionTexto].filter(Boolean).join(' · ') || '—'}
          </Dato>
          <Dato titulo="Punto de control">
            {activo.puntoCodigo
              ? <>{activo.puntoCodigo} · {activo.puntoNombre}</>
              : <span className="text-gray-400">Sin punto</span>}
          </Dato>
          <Dato titulo="Serial">{activo.serial ?? '—'}</Dato>
          <Dato titulo="Instalado el">{activo.fechaInstalacion ?? '—'}</Dato>
          <Dato titulo="Garantía hasta">{activo.garantiaHasta ?? '—'}</Dato>
          <Dato titulo="Proveedor">{activo.proveedorNombre ?? '—'}</Dato>
          <Dato titulo="Activo padre">
            {activo.padre
              ? <Link href={`/rondas/activos/${activo.padre.id}`} className="text-brand-green hover:underline">
                  {activo.padre.codigo} · {activo.padre.nombre}
                </Link>
              : <span className="text-gray-400">Ninguno</span>}
          </Dato>
        </dl>
        {activo.descripcion && (
          <p className="font-body mt-3 text-sm text-gray-600">{activo.descripcion}</p>
        )}
        {activo.observaciones && (
          <p className="font-body mt-2 rounded-lg bg-gray-50 p-3 text-sm text-gray-600">
            {activo.observaciones}
          </p>
        )}
        {hijos.length > 0 && (
          <div className="mt-4">
            <span className={etiqueta}>Activos que cuelgan de este</span>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {hijos.map((h) => (
                <li key={h.id}>
                  <Link href={`/rondas/activos/${h.id}`}
                    className="font-body inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50">
                    <span className="font-mono text-[11px] text-gray-400">{h.codigo}</span> {h.nombre}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Placa QR ─────────────────────────────────────────────────────── */}
      <div className={tarjeta}>
        <h2 className="font-heading mb-1 flex items-center gap-2 font-semibold text-gray-900">
          <QrCode className="h-4 w-4 text-brand-green" /> Placa del activo
        </h2>
        <p className="font-body mb-3 text-sm text-gray-500">
          El código va firmado y va impreso: cambiarlo obliga a volver al sitio a cambiar la
          placa. Escanearlo abre la ficha pública de este activo en <span className="font-mono">/q/</span>.
        </p>

        {!llaveLista && (
          <p className="font-body mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            No hay llave de firma configurada en el servidor
            {llaveId ? ` (falta el secreto de "${llaveId}")` : ' (falta RONDA_HMAC_LLAVE_ACTUAL)'}.
            Sin ella no se pueden emitir placas, porque nadie podría verificarlas.
          </p>
        )}

        {qrActivo ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <div>
                <span className={etiqueta}>Código impreso</span>
                <p className="font-mono text-lg font-semibold text-gray-900">
                  {formatearManual(qrActivo.codigoManual)}
                </p>
              </div>
              <div>
                <span className={etiqueta}>Versión</span>
                <p className="font-body text-sm text-gray-700">v{qrActivo.version}</p>
              </div>
              <div>
                <span className={etiqueta}>Impresiones</span>
                <p className="font-body text-sm text-gray-700">{qrActivo.impresiones}</p>
              </div>
              <div className="min-w-0 flex-1">
                <span className={etiqueta}>Lo que lleva el QR</span>
                <p className="font-mono truncate text-xs text-gray-500">
                  {urlDelQr(qrActivo.token, base || 'https://…')}
                </p>
              </div>
            </div>

            {puedeQr && (
              <div className="flex flex-wrap items-center gap-2">
                <select value={formato} onChange={(e) => setFormato(e.target.value as FormatoLote)}
                  className={`${campo} w-auto`} aria-label="Formato de la placa">
                  {FORMATOS_LOTE.map((f) => (
                    <option key={f} value={f}>{FORMATOS[f].label}</option>
                  ))}
                </select>
                <button onClick={imprimir}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white">
                  <Printer className="h-4 w-4" /> Imprimir placa
                </button>
                <form action={accionQr} className="inline-flex items-center gap-1.5">
                  <input type="hidden" name="activo_id" value={activo.id} />
                  <input name="motivo" required placeholder="Motivo del reemplazo"
                    className={`${campo} w-48`} />
                  <Guardar label="Reemplazar" />
                </form>
                <button onClick={revocar}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 font-body text-sm text-gray-600 hover:bg-red-50 hover:text-red-600">
                  <X className="h-4 w-4" /> Revocar
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="font-body text-sm text-gray-500">
              Este activo todavía no tiene placa.
              {activo.puntoCodigo && ' Si está donde ya hay una, puede usar la del punto ' + activo.puntoCodigo + '.'}
            </p>
            {puedeQr && llaveLista && (
              <form action={accionQr}>
                <input type="hidden" name="activo_id" value={activo.id} />
                <Guardar label="Emitir placa" />
              </form>
            )}
          </div>
        )}

        {qrs.length > 1 && (
          <div className="mt-4">
            <span className={etiqueta}>Histórico de placas</span>
            <ul className="mt-1 divide-y divide-gray-100">
              {qrs.map((q) => (
                <li key={q.id} className="font-body flex flex-wrap items-center gap-2 py-1.5 text-xs text-gray-600">
                  <span className="font-mono">{formatearManual(q.codigoManual)}</span>
                  <span className="text-gray-400">v{q.version}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${ESTADO_QR[q.estado].badge}`}>
                    {ESTADO_QR[q.estado].label}
                  </span>
                  {q.motivoCambio && <span className="text-gray-400">· {q.motivoCambio}</span>}
                  <span className="text-gray-400">· {fechaHora(q.createdAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* ── Documentos ───────────────────────────────────────────────────── */}
      <div className={tarjeta}>
        <h2 className="font-heading mb-1 flex items-center gap-2 font-semibold text-gray-900">
          <FileText className="h-4 w-4 text-brand-green" /> Documentos
        </h2>
        <p className="font-body mb-3 text-sm text-gray-500">
          Ficha técnica, manual, garantía y certificados. Van en un bucket privado: se abren con
          un enlace firmado que caduca en cinco minutos.
        </p>

        {puedeGestionar && (
          <form action={accionDoc} className="mb-4 space-y-3 rounded-lg bg-gray-50 p-3">
            <input type="hidden" name="activo_id" value={activo.id} />
            {archivo && (
              <>
                <input type="hidden" name="archivo_path" value={archivo.path} />
                <input type="hidden" name="nombre_archivo" value={archivo.nombre} />
                <input type="hidden" name="mime" value={archivo.mime} />
                <input type="hidden" name="tamano" value={archivo.tamano} />
              </>
            )}
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1">
                <span className={etiqueta}>Archivo</span>
                <input ref={archivoRef} type="file" disabled={subiendo}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) subir(f) }}
                  className="block font-body text-sm text-gray-600" />
                {subiendo && (
                  <span className="font-body inline-flex items-center gap-1 text-[11px] text-gray-500">
                    <Loader2 className="h-3 w-3 animate-spin" /> subiendo…
                  </span>
                )}
                {archivo && (
                  <span className="font-body inline-flex items-center gap-1 text-[11px] text-emerald-700">
                    <Upload className="h-3 w-3" /> {archivo.nombre} ({tamanoCorto(archivo.tamano)})
                  </span>
                )}
              </label>
              <label className="space-y-1">
                <span className={etiqueta}>Tipo</span>
                <select name="tipo" defaultValue="FICHA_TECNICA" className={`${campo} w-auto`}>
                  {TIPOS_DOCUMENTO_ACTIVO.map((t) => (
                    <option key={t} value={t}>{TIPO_DOCUMENTO_ACTIVO[t].label}</option>
                  ))}
                </select>
              </label>
              <label className="min-w-[12rem] flex-1 space-y-1">
                <span className={etiqueta}>Nombre</span>
                <input name="nombre" required placeholder="Ficha técnica del fabricante"
                  className={campo} />
              </label>
              <label className="space-y-1">
                <span className={etiqueta}>Vence</span>
                <input type="date" name="vence_at" className={`${campo} w-auto`} />
              </label>
              <button type="submit" disabled={!archivo}
                className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-3 py-2 font-body text-sm font-semibold text-white disabled:opacity-50">
                <Save className="h-4 w-4" /> Guardar documento
              </button>
            </div>
          </form>
        )}

        {documentos.length === 0 ? (
          <p className="font-body text-sm text-gray-400">Todavía no hay documentos.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {documentos.map((d) => {
              const venc = d.venceAt ? estadoGarantia(d.venceAt) : null
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                  <FileText className="h-4 w-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="font-body truncate text-sm font-semibold text-gray-900">{d.nombre}</p>
                    <p className="font-body text-xs text-gray-500">
                      {TIPO_DOCUMENTO_ACTIVO[d.tipo].label} · {tamanoCorto(d.tamano)} ·{' '}
                      {d.nombreArchivo ?? '—'}
                      {d.venceAt && venc && (
                        <span className={venc.vencida ? ' text-red-600' : ' text-amber-600'}>
                          {' '}· {venc.vencida ? `vencido el ${d.venceAt}` : `vence el ${d.venceAt}`}
                        </span>
                      )}
                    </p>
                  </div>
                  <button onClick={() => ver(d)} title="Abrir"
                    className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 font-body text-xs text-gray-600 hover:bg-gray-50">
                    <Eye className="h-3.5 w-3.5" /> Abrir
                  </button>
                  {puedeGestionar && (
                    <button onClick={() => borrarDoc(d)} title="Borrar"
                      className="rounded-lg border border-gray-200 p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* ── Medidores y lecturas ─────────────────────────────────────────── */}
      <div className={tarjeta}>
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading flex items-center gap-2 font-semibold text-gray-900">
            <Gauge className="h-4 w-4 text-brand-green" /> Medidores
          </h2>
          {puedeGestionar && !medidorNuevo && !medidorEditando && (
            <button onClick={() => { setMedidorNuevo(true); setTipoMedidorForm(activo.tipoMedidor ?? 'HORAS') }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 font-body text-sm text-gray-700 hover:bg-gray-50">
              <Plus className="h-4 w-4" /> Nuevo medidor
            </button>
          )}
        </div>
        <p className="font-body mb-3 text-sm text-gray-500">
          Un contador (horas, ciclos) solo sube: la base rechaza una lectura menor que la mayor ya
          registrada. Una lectura de instrumento sí puede bajar. El valor del medidor sale siempre
          de la última lectura, no se escribe a mano.
        </p>

        {activo.tipoExigeMedidor && medidores.length === 0 && (
          <p className="font-body mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            El tipo de este activo suele llevar medidor de{' '}
            {TIPO_MEDIDOR[activo.tipoMedidor ?? 'HORAS'].label.toLowerCase()} y todavía no tiene
            ninguno. Sin medidor no se le puede programar un plan por horas o por ciclos.
          </p>
        )}

        {puedeGestionar && (medidorNuevo || medidorEditando) && (
          <form action={accionMedidor} className="mb-4 space-y-3 rounded-lg bg-gray-50 p-3">
            <input type="hidden" name="activo_id" value={activo.id} />
            {medidorEditando && <input type="hidden" name="id" value={medidorEditando.id} />}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1">
                <span className={etiqueta}>Código</span>
                <input name="codigo" defaultValue={medidorEditando?.codigo ?? 'PRINCIPAL'}
                  className={campo} disabled={!!medidorEditando} />
              </label>
              <label className="space-y-1">
                <span className={etiqueta}>Nombre</span>
                <input name="nombre" required defaultValue={medidorEditando?.nombre ?? ''}
                  placeholder="Horómetro" className={campo} />
              </label>
              <label className="space-y-1">
                <span className={etiqueta}>Clase</span>
                <select name="tipo" value={medidorEditando?.tipo ?? tipoMedidorForm}
                  onChange={(e) => setTipoMedidorForm(e.target.value as TipoMedidor)}
                  disabled={!!medidorEditando} className={campo}>
                  {TIPOS_MEDIDOR.map((t) => (
                    <option key={t} value={t}>{TIPO_MEDIDOR[t].label}</option>
                  ))}
                </select>
                <span className="font-body text-[11px] text-gray-400">
                  {TIPO_MEDIDOR[medidorEditando?.tipo ?? tipoMedidorForm].detalle}
                </span>
              </label>
              <label className="space-y-1">
                <span className={etiqueta}>Unidad</span>
                <input name="unidad"
                  defaultValue={medidorEditando?.unidad
                    ?? activo.tipoMedidorUnidad
                    ?? TIPO_MEDIDOR[tipoMedidorForm].unidad}
                  className={campo} />
              </label>
              <label className="space-y-1">
                <span className={etiqueta}>Decimales</span>
                <input type="number" name="decimales" min={0} max={3}
                  defaultValue={medidorEditando?.decimales ?? 0} className={campo} />
              </label>
              <label className="space-y-1">
                <span className={etiqueta}>Avisar al llegar a</span>
                <input name="valor_alerta" defaultValue={medidorEditando?.valorAlerta ?? ''}
                  placeholder="(opcional)" className={campo} />
              </label>
              <label className="inline-flex items-center gap-2 self-end font-body text-sm text-gray-700">
                <input type="checkbox" name="acumulativo" className="rounded border-gray-300"
                  defaultChecked={medidorEditando?.acumulativo
                    ?? acumulativoPorDefecto(tipoMedidorForm)} />
                Solo sube (contador)
              </label>
              <label className="inline-flex items-center gap-2 self-end font-body text-sm text-gray-700">
                <input type="checkbox" name="activo" className="rounded border-gray-300"
                  defaultChecked={medidorEditando?.activo ?? true} />
                En uso
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Guardar label={medidorEditando ? 'Guardar cambios' : 'Crear medidor'} />
              <button type="button" onClick={() => { setMedidorNuevo(false); setMedidorEditando(null) }}
                className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
            </div>
          </form>
        )}

        {medidores.length === 0 ? (
          <p className="font-body text-sm text-gray-400">Este activo no tiene medidores.</p>
        ) : (
          <div className="space-y-4">
            {medidores.map((m) => {
              const suyas = lecturasPorMedidor.get(m.id) ?? []
              const alerta = medidorEnAlerta(m.valorActual, m.valorAlerta)
              return (
                <div key={m.id} className="rounded-lg border border-gray-200">
                  <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-body text-sm font-semibold text-gray-900">
                        {m.nombre}{' '}
                        <span className="font-mono text-[11px] text-gray-400">{m.codigo}</span>
                      </p>
                      <p className="font-body text-xs text-gray-500">
                        {TIPO_MEDIDOR[m.tipo].label} ·{' '}
                        {m.acumulativo ? 'solo sube' : 'puede subir y bajar'}
                        {!m.activo && ' · inactivo'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`font-heading text-lg font-bold ${alerta ? 'text-red-600' : 'text-gray-900'}`}>
                        {valorMedidor(m.valorActual, m.unidad, m.decimales)}
                      </p>
                      <p className="font-body text-[11px] text-gray-400">
                        {m.leidoAt ? `leído el ${fechaHora(m.leidoAt)}` : 'sin lecturas'}
                      </p>
                    </div>
                    {alerta && (
                      <span className="inline-flex items-center gap-1 rounded bg-red-50 px-2 py-1 font-body text-[11px] font-semibold text-red-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        pasó el aviso de {valorMedidor(m.valorAlerta, m.unidad, m.decimales)}
                      </span>
                    )}
                    <div className="flex items-center gap-1.5">
                      {puedeLeer && m.activo && (
                        <button onClick={() => setLecturaDe(lecturaDe?.id === m.id ? null : m)}
                          className="rounded-lg border border-gray-200 px-2 py-1 font-body text-xs font-semibold text-gray-700 hover:bg-gray-50">
                          Registrar lectura
                        </button>
                      )}
                      {puedeGestionar && (
                        <>
                          <button onClick={() => { setMedidorNuevo(false); setMedidorEditando(m) }}
                            className="rounded-lg border border-gray-200 px-2 py-1 font-body text-xs text-gray-600 hover:bg-gray-50">
                            Editar
                          </button>
                          <button onClick={() => borrarMed(m)} title="Borrar"
                            className="rounded-lg border border-gray-200 p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {lecturaDe?.id === m.id && (
                    <form action={accionLectura} className="flex flex-wrap items-end gap-3 bg-gray-50 p-3">
                      <input type="hidden" name="medidor_id" value={m.id} />
                      <input type="hidden" name="activo_id" value={activo.id} />
                      <label className="space-y-1">
                        <span className={etiqueta}>Valor en {m.unidad || 'unidades'}</span>
                        <input name="valor" required autoFocus inputMode="decimal"
                          className={`${campo} w-40`} />
                      </label>
                      <label className="space-y-1">
                        <span className={etiqueta}>Leído el</span>
                        <input type="datetime-local" name="leido_at" className={`${campo} w-auto`} />
                      </label>
                      <label className="min-w-[10rem] flex-1 space-y-1">
                        <span className={etiqueta}>Nota</span>
                        <input name="nota" placeholder="(opcional)" className={campo} />
                      </label>
                      <Guardar label="Registrar" />
                      <button type="button" onClick={() => setLecturaDe(null)}
                        className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
                    </form>
                  )}

                  {suyas.length > 0 && (
                    <ul className="divide-y divide-gray-50">
                      {suyas.slice(0, 10).map((l) => (
                        <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                          <span className="font-body w-28 text-sm font-semibold text-gray-800">
                            {valorMedidor(l.valor, m.unidad, m.decimales)}
                          </span>
                          <span className="font-body text-xs text-gray-500">{fechaHora(l.leidoAt)}</span>
                          {l.delta !== null && (
                            <span className="font-body text-xs text-gray-400">
                              {l.delta >= 0 ? '+' : ''}{valorMedidor(l.delta, m.unidad, m.decimales)}
                            </span>
                          )}
                          <span className="font-body text-xs text-gray-400">{ORIGEN_LECTURA[l.origen]}</span>
                          {l.nota && <span className="font-body text-xs text-gray-400">· {l.nota}</span>}
                          <span className="flex-1" />
                          {puedeGestionar && (
                            <button onClick={() => borrarLec(l)} title="Borrar la lectura"
                              className="p-1 text-gray-300 hover:text-red-600">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </li>
                      ))}
                      {suyas.length > 10 && (
                        <li className="font-body flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400">
                          <Download className="h-3.5 w-3.5" />
                          Se muestran las 10 últimas de las {suyas.length} que trajo la página.
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className={etiqueta}>{titulo}</dt>
      <dd className="font-body text-sm text-gray-800">{children}</dd>
    </div>
  )
}

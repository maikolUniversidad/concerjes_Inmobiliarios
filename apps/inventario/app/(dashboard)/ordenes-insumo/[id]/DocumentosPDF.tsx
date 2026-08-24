'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { FileDown, Loader2, Truck, ClipboardList, Building2, Download, FileText, Eye, MapPin, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { registrarGeneracionPDF, guardarDireccionSede } from '../actions'

export interface DatosDoc {
  ordenId: string
  sedeId: string
  numero: string
  estado: string
  created_at: string
  aprobado_at?: string | null
  despachado_at?: string | null
  observacion: string | null
  sede: string
  direccion: string | null
  grupo: string | null
  bodega: string | null
  responsables: string[]
  items: {
    codigo: number | string | null
    nombre: string
    presentacion: string | null
    solicitada: number
    alistada: number
  }[]
}

interface PdfHistorialItem {
  id: string
  tipo: 'ORDEN' | 'REMISION'
  path: string
  version: number
  usuario_nombre: string | null
  created_at: string
}

type Tipo = 'ORDEN' | 'REMISION'

interface Emisor { nombre: string; nit: string; tel: string; direccion: string | null; logoDataUrl: string | null }

interface EmisoraRaw {
  id: string; razon_social: string; nombre_comercial: string | null
  nit: string | null; telefono: string | null; direccion: string | null; logo_path: string | null
}

const EMPRESA_FALLBACK: Emisor = { nombre: 'CONSERJES INMOBILIARIOS LTDA', nit: 'NIT 800093388-2', tel: '+57 320 808 1399', direccion: null, logoDataUrl: null }

async function comoDataUrl(url: string): Promise<string | null> {
  try {
    const r = await fetch(url); if (!r.ok) return null
    const b = await r.blob()
    return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result as string); fr.onerror = () => res(null); fr.readAsDataURL(b) })
  } catch { return null }
}

function fecha(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
}

/**
 * Genera / previsualiza el PDF (orden de insumo o remisión de despacho) para
 * imprimir y enviarlo físicamente con el pedido. Se construye en el navegador
 * con @react-pdf/renderer (import dinámico: librería pesada y client-only).
 */
export function DocumentosPDF({ datos }: { datos: DatosDoc }) {
  const { ordenId } = datos
  const [generando, setGenerando] = useState<Tipo | null>(null)
  const [previsualizando, setPrevisualizando] = useState<Tipo | null>(null)
  const [emisoras, setEmisoras] = useState<EmisoraRaw[]>([])
  const [emisoraId, setEmisoraId] = useState<string>('')
  const logoCache = useRef<Map<string, string | null>>(new Map())
  const [historial, setHistorial] = useState<PdfHistorialItem[]>([])
  const [descargando, setDescargando] = useState<string | null>(null)
  const [viendo, setViendo] = useState<string | null>(null)

  // Dirección de despacho: viene de la sede; si no la tiene, se registra aquí.
  const [direccion, setDireccion] = useState(datos.direccion ?? '')
  const [guardandoDir, setGuardandoDir] = useState(false)
  const dirGuardada = (datos.direccion ?? '')

  // Modal de previsualización (iframe con el PDF).
  const [preview, setPreview] = useState<{ url: string; titulo: string; blob: boolean } | null>(null)
  const cerrarPreview = useCallback(() => {
    setPreview((p) => { if (p?.blob) URL.revokeObjectURL(p.url); return null })
  }, [])

  const cargarHistorial = useCallback(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    const { data } = await sb.from('orden_insumo_eventos')
      .select('id, usuario_nombre, created_at, detalle')
      .eq('orden_id', ordenId).eq('tipo', 'PDF_GENERADO')
      .order('created_at', { ascending: false })
    setHistorial(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((data ?? []) as any[]).map(e => ({
        id: e.id,
        tipo: (e.detalle?.tipo ?? 'ORDEN') as 'ORDEN' | 'REMISION',
        path: e.detalle?.path ?? '',
        version: Number(e.detalle?.version ?? 1),
        usuario_nombre: e.usuario_nombre ?? null,
        created_at: e.created_at,
      })),
    )
  }, [ordenId])

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = createClient() as any
    sb.from('empresas_emisoras')
      .select('id, razon_social, nombre_comercial, nit, telefono, direccion, logo_path, es_predeterminada')
      .eq('activo', true)
      .order('es_predeterminada', { ascending: false })
      .order('razon_social', { ascending: true })
      .then(({ data }: { data: (EmisoraRaw & { es_predeterminada: boolean })[] | null }) => {
        const lista = data ?? []
        setEmisoras(lista)
        const predet = lista.find(e => e.es_predeterminada) ?? lista[0]
        if (predet) setEmisoraId(predet.id)
      })
    cargarHistorial()
  }, [cargarHistorial])

  // Limpia el object URL al desmontar.
  useEffect(() => () => { if (preview?.blob) URL.revokeObjectURL(preview.url) }, [preview])

  async function resolverEmisor(): Promise<Emisor> {
    const raw = emisoras.find(e => e.id === emisoraId)
    if (!raw) return EMPRESA_FALLBACK
    let logoDataUrl: string | null = null
    if (raw.logo_path) {
      if (logoCache.current.has(raw.id)) {
        logoDataUrl = logoCache.current.get(raw.id) ?? null
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = createClient() as any
        const url = sb.storage.from('empresas').getPublicUrl(raw.logo_path).data.publicUrl
        logoDataUrl = await comoDataUrl(url)
        logoCache.current.set(raw.id, logoDataUrl)
      }
    }
    return {
      nombre: raw.razon_social,
      nit: raw.nit ? `NIT ${raw.nit}` : '',
      tel: raw.telefono ?? '',
      direccion: raw.direccion ?? null,
      logoDataUrl,
    }
  }

  /** Construye el PDF y devuelve el Blob (usa la dirección de despacho actual). */
  async function construirBlob(tipo: Tipo): Promise<Blob> {
    const emisor = await resolverEmisor()
    const { pdf, Document, Page, Text, View, Image, StyleSheet } = await import('@react-pdf/renderer')
    const React = (await import('react')).default
    const h = React.createElement

    const s = StyleSheet.create({
      page: { padding: 34, fontSize: 9, fontFamily: 'Helvetica', color: '#111827' },
      empresa: { fontSize: 13, fontFamily: 'Helvetica-Bold' },
      sub: { fontSize: 8, color: '#6b7280' },
      titulo: { fontSize: 14, fontFamily: 'Helvetica-Bold', textAlign: 'right' },
      numero: { fontSize: 11, textAlign: 'right', color: '#2E7D32', fontFamily: 'Helvetica-Bold' },
      head: { flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 2, borderBottomColor: '#2E7D32', paddingBottom: 8, marginBottom: 12 },
      box: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4, padding: 8, marginBottom: 10 },
      row: { flexDirection: 'row', marginBottom: 3 },
      lbl: { width: 90, color: '#6b7280' },
      val: { flex: 1, fontFamily: 'Helvetica-Bold' },
      th: { flexDirection: 'row', backgroundColor: '#f3f4f6', paddingVertical: 5, paddingHorizontal: 4, fontFamily: 'Helvetica-Bold' },
      tr: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
      cCod: { width: 66 }, cProd: { flex: 1 }, cNum: { width: 66, textAlign: 'right' },
      // Columna en blanco de la remisión: la sede anota a mano lo que devuelve.
      cDev: { width: 62, paddingRight: 6 },
      cDevLinea: { height: 11, borderBottomWidth: 1, borderBottomColor: '#9ca3af' },
      // Empuja las firmas al pie de la página cuando sobra espacio.
      relleno: { flexGrow: 1, minHeight: 24 },
      firma: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 26, marginBottom: 26 },
      firmaBox: { width: '45%' },
      firmaEspacio: { height: 40 },
      firmaLinea: { borderTopWidth: 1, borderTopColor: '#111827', paddingTop: 4, fontSize: 8, textAlign: 'center' },
      pie: { position: 'absolute', bottom: 22, left: 34, right: 34, fontSize: 7, color: '#9ca3af', textAlign: 'center' },
    })

    const esRemision = tipo === 'REMISION'
    const cantLabel = esRemision ? 'DESPACHADO' : 'SOLICITADO'
    const cantOf = (i: DatosDoc['items'][number]) => (esRemision ? i.alistada : i.solicitada)
    // La remisión de despacho SOLO lleva lo alistado (cantidad > 0). La orden de
    // insumo lista todos los solicitados.
    const itemsDoc = esRemision ? datos.items.filter((i) => Number(i.alistada) > 0) : datos.items
    const total = itemsDoc.reduce((a, i) => a + cantOf(i), 0)
    const dir = (direccion || '').trim() || datos.direccion || null

    const doc = h(Document, { title: `${tipo}-${datos.numero}` },
      h(Page, { size: 'LETTER', style: s.page },
        h(View, { style: s.head },
          h(View, { style: { flexDirection: 'row', alignItems: 'center' } },
            emisor.logoDataUrl ? h(Image, { src: emisor.logoDataUrl, style: { width: 46, height: 46, objectFit: 'contain', marginRight: 8 } }) : null,
            h(View, null,
              h(Text, { style: s.empresa }, emisor.nombre),
              h(Text, { style: s.sub }, [emisor.nit, emisor.tel].filter(Boolean).join(' · ')),
              emisor.direccion ? h(Text, { style: s.sub }, emisor.direccion) : null,
            ),
          ),
          h(View, null,
            h(Text, { style: s.titulo }, esRemision ? 'REMISIÓN DE DESPACHO' : 'ORDEN DE INSUMO'),
            h(Text, { style: s.numero }, datos.numero),
          ),
        ),
        h(View, { style: s.box },
          h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Sede destino'), h(Text, { style: s.val }, datos.sede)),
          dir ? h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Dirección'), h(Text, { style: s.val }, dir)) : null,
          datos.grupo ? h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Contrato'), h(Text, { style: s.val }, datos.grupo)) : null,
          h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Bodega'), h(Text, { style: s.val }, datos.bodega ?? '—')),
          h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Fecha solicitud'), h(Text, { style: s.val }, fecha(datos.created_at))),
          h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Aprobación'), h(Text, { style: s.val }, fecha(datos.aprobado_at))),
          esRemision ? h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Despacho'), h(Text, { style: s.val }, fecha(datos.despachado_at))) : null,
          datos.responsables.length
            ? h(View, { style: s.row }, h(Text, { style: s.lbl }, 'Responsables'), h(Text, { style: s.val }, datos.responsables.join(', ')))
            : null,
        ),
        h(View, { style: s.th },
          esRemision ? h(Text, { style: s.cDev }, 'DEVUELTO') : null,
          h(Text, { style: s.cCod }, 'CÓDIGO'),
          h(Text, { style: s.cProd }, 'PRODUCTO'),
          h(Text, { style: s.cNum }, cantLabel),
        ),
        ...itemsDoc.map((i, k) =>
          h(View, { style: s.tr, key: String(k), wrap: false },
            // Casilla en blanco para anotar a mano las unidades devueltas.
            esRemision ? h(View, { style: s.cDev }, h(View, { style: s.cDevLinea })) : null,
            h(Text, { style: s.cCod }, i.codigo != null && i.codigo !== '' ? String(i.codigo) : '—'),
            h(View, { style: s.cProd },
              h(Text, null, i.nombre),
              i.presentacion ? h(Text, { style: s.sub }, i.presentacion) : null,
            ),
            h(Text, { style: s.cNum }, String(cantOf(i))),
          ),
        ),
        h(View, { style: [s.tr, { borderBottomWidth: 0, backgroundColor: '#f9fafb' }] },
          esRemision ? h(Text, { style: s.cDev }, '') : null,
          h(Text, { style: s.cCod }, ''),
          h(Text, { style: [s.cProd, { fontFamily: 'Helvetica-Bold' }] }, `TOTAL · ${itemsDoc.length} ítem(s)`),
          h(Text, { style: [s.cNum, { fontFamily: 'Helvetica-Bold' }] }, String(total)),
        ),
        esRemision
          ? h(Text, { style: [s.sub, { marginTop: 6 }] },
              'Si la sede regresa producto, anote las unidades en la columna DEVUELTO y déjelo firmado.')
          : null,
        datos.observacion
          ? h(View, { style: [s.box, { marginTop: 10 }] },
              h(Text, { style: s.sub }, 'Observaciones'),
              h(Text, null, datos.observacion),
            )
          : null,
        // Espaciador: si la página tiene sitio, las firmas bajan al pie.
        h(View, { style: s.relleno }),
        h(View, { style: s.firma },
          h(View, { style: s.firmaBox },
            h(View, { style: s.firmaEspacio }),
            h(Text, { style: s.firmaLinea }, esRemision ? 'Entregado por (bodega)' : 'Solicitado por (coordinador)'),
          ),
          h(View, { style: s.firmaBox },
            h(View, { style: s.firmaEspacio }),
            h(Text, { style: s.firmaLinea }, esRemision ? 'Recibido por (sede) — nombre, C.C. y fecha' : 'Aprobado por (central)'),
          ),
        ),
        h(Text, { style: s.pie }, `${emisor.nombre} · Documento generado por la plataforma · ${new Date().toLocaleString('es-CO')}`),
      ),
    )
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await pdf(doc as any).toBlob()
  }

  /** Previsualiza sin descargar ni registrar (solo abre el visor). */
  async function previsualizar(tipo: Tipo) {
    setPrevisualizando(tipo)
    try {
      const blob = await construirBlob(tipo)
      cerrarPreview()
      setPreview({ url: URL.createObjectURL(blob), titulo: tipo === 'REMISION' ? 'Remisión de despacho' : 'Orden de insumo', blob: true })
    } catch (e) {
      toast.error('No se pudo previsualizar: ' + (e instanceof Error ? e.message : 'error'))
    } finally {
      setPrevisualizando(null)
    }
  }

  /** Genera + descarga + almacena + registra en el historial. */
  async function generar(tipo: Tipo) {
    setGenerando(tipo)
    try {
      const blob = await construirBlob(tipo)
      const esRemision = tipo === 'REMISION'

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${esRemision ? 'Remision' : 'Orden'}_${datos.numero}.pdf`
      a.click()
      URL.revokeObjectURL(url)

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = createClient() as any
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
        const storagePath = `ordenes/${ordenId}/pdfs/${tipo}_${ts}.pdf`
        const { error: upErr } = await sb.storage.from('ordenes-insumo')
          .upload(storagePath, blob, { contentType: 'application/pdf', upsert: false })
        if (!upErr) {
          await registrarGeneracionPDF(ordenId, tipo, storagePath)
          await cargarHistorial()
        }
      } catch {
        // El almacenamiento falla silenciosamente: el usuario ya tiene el PDF.
      }

      toast.success(`${esRemision ? 'Remisión' : 'Orden'} generada`)
    } catch (e) {
      toast.error('No se pudo generar el PDF: ' + (e instanceof Error ? e.message : 'error'))
    } finally {
      setGenerando(null)
    }
  }

  async function guardarDir() {
    setGuardandoDir(true)
    try {
      const r = await guardarDireccionSede(datos.sedeId, direccion)
      if (r.error) { toast.error(r.error); return }
      toast.success('Dirección registrada en la sede')
    } finally {
      setGuardandoDir(false)
    }
  }

  async function verHistorial(item: PdfHistorialItem) {
    setViendo(item.id)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createClient() as any
      const { data } = await sb.storage.from('ordenes-insumo').createSignedUrl(item.path, 3600)
      if (!data?.signedUrl) { toast.error('No se pudo abrir el PDF.'); return }
      cerrarPreview()
      setPreview({ url: data.signedUrl, titulo: `${item.tipo === 'REMISION' ? 'Remisión' : 'Orden'} v${item.version}`, blob: false })
    } catch {
      toast.error('Error al abrir el PDF.')
    } finally {
      setViendo(null)
    }
  }

  async function descargarHistorial(item: PdfHistorialItem) {
    setDescargando(item.id)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sb = createClient() as any
      const { data } = await sb.storage.from('ordenes-insumo').createSignedUrl(item.path, 3600)
      if (!data?.signedUrl) { toast.error('No se pudo obtener el enlace de descarga.'); return }
      const a = document.createElement('a')
      a.href = data.signedUrl
      a.download = `${item.tipo === 'REMISION' ? 'Remision' : 'Orden'}_${datos.numero}_v${item.version}.pdf`
      a.click()
    } catch {
      toast.error('Error al descargar el PDF.')
    } finally {
      setDescargando(null)
    }
  }

  const aprobada = ['APROBADA', 'EN_ALISTAMIENTO', 'ALISTADO', 'DESPACHADO'].includes(datos.estado)
  const ocupado = generando !== null || previsualizando !== null

  return (
    <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-1">
        <FileDown className="w-4 h-4 text-brand-green" />
        <h2 className="font-heading font-semibold text-base text-gray-900">Documentos para imprimir</h2>
      </div>
      <p className="font-body text-sm text-gray-500 mb-3">
        La <strong>remisión</strong> se imprime y viaja físicamente con el pedido; la firma quien recibe en la sede.
      </p>

      {/* Dirección de despacho: de la sede; si no la tiene, se registra aquí */}
      <div className="mb-3 rounded-lg border border-gray-100 bg-gray-50/70 p-3">
        <span className="flex items-center gap-1.5 font-body text-xs font-semibold text-gray-500 mb-1">
          <MapPin className="w-3.5 h-3.5 text-brand-green" /> Dirección de despacho
          {!dirGuardada && <span className="text-amber-600">· la sede no tiene una registrada</span>}
        </span>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            placeholder="Dirección de entrega de la sede"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green bg-white"
          />
          <button
            onClick={guardarDir}
            disabled={guardandoDir || !direccion.trim() || direccion.trim() === dirGuardada.trim()}
            className="inline-flex items-center justify-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 hover:bg-white disabled:opacity-50"
            title="Guardar la dirección en la sede"
          >
            {guardandoDir ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar en la sede
          </button>
        </div>
      </div>

      {/* Empresa emisora */}
      {emisoras.length > 1 && (
        <label className="block mb-3">
          <span className="flex items-center gap-1.5 font-body text-xs font-semibold text-gray-500 mb-1">
            <Building2 className="w-3.5 h-3.5 text-brand-green" /> Generar con la empresa
          </span>
          <select
            value={emisoraId}
            onChange={e => setEmisoraId(e.target.value)}
            disabled={ocupado}
            className="w-full sm:w-auto min-w-[16rem] border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-brand-green/30 focus:border-brand-green disabled:opacity-50"
          >
            {emisoras.map(e => (
              <option key={e.id} value={e.id}>
                {e.nombre_comercial?.trim() || e.razon_social}{e.nit ? ` · NIT ${e.nit}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      {/* Orden de insumo: previsualizar / descargar */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-body text-xs font-semibold text-gray-400 w-28 shrink-0">Orden de insumo</span>
          <button onClick={() => previsualizar('ORDEN')} disabled={ocupado}
            className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {previsualizando === 'ORDEN' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Previsualizar
          </button>
          <button onClick={() => generar('ORDEN')} disabled={ocupado}
            className="flex items-center gap-1.5 border border-gray-200 rounded-lg px-3 py-2 font-body text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50">
            {generando === 'ORDEN' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardList className="w-4 h-4" />} Descargar
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-body text-xs font-semibold text-gray-400 w-28 shrink-0">Remisión</span>
          <button onClick={() => previsualizar('REMISION')} disabled={ocupado || !aprobada}
            title={aprobada ? '' : 'Disponible cuando la orden esté aprobada'}
            className="flex items-center gap-1.5 border border-brand-green/40 text-brand-green rounded-lg px-3 py-2 font-body text-sm hover:bg-brand-green/5 disabled:opacity-50">
            {previsualizando === 'REMISION' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Previsualizar
          </button>
          <button onClick={() => generar('REMISION')} disabled={ocupado || !aprobada}
            title={aprobada ? '' : 'Disponible cuando la orden esté aprobada'}
            className="flex items-center gap-1.5 bg-brand-green text-white rounded-lg px-3 py-2 font-body font-semibold text-sm hover:bg-brand-green-dark disabled:opacity-50">
            {generando === 'REMISION' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Descargar
          </button>
        </div>
      </div>
      {!aprobada && (
        <p className="font-body text-xs text-amber-700 mt-2">La remisión se habilita cuando la orden está aprobada.</p>
      )}

      {/* Historial de PDFs generados */}
      {historial.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5" /> PDFs almacenados
          </p>
          <div className="space-y-1.5">
            {historial.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-body text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      item.tipo === 'REMISION' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'
                    }`}>
                      {item.tipo === 'REMISION' ? 'Remisión' : 'Orden'} v{item.version}
                    </span>
                    <span className="font-body text-xs text-gray-400">
                      {item.usuario_nombre ?? 'Sistema'} · {fecha(item.created_at)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    onClick={() => verHistorial(item)}
                    disabled={viendo === item.id}
                    title="Previsualizar esta versión"
                    className="flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-xs text-gray-600 hover:bg-white hover:border-gray-300 disabled:opacity-40"
                  >
                    {viendo === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                    Ver
                  </button>
                  <button
                    onClick={() => descargarHistorial(item)}
                    disabled={descargando === item.id}
                    title="Descargar esta versión"
                    className="flex items-center gap-1 border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-xs text-gray-600 hover:bg-white hover:border-gray-300 disabled:opacity-40"
                  >
                    {descargando === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                    Descargar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visor de PDF */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
          <div className="absolute inset-0 bg-black/50" onClick={cerrarPreview} />
          <div className="relative flex h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <p className="font-heading font-semibold text-sm text-gray-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-brand-green" /> {preview.titulo} · {datos.numero}
              </p>
              <button onClick={cerrarPreview} className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <iframe src={preview.url} title="Previsualización" className="flex-1 w-full bg-gray-100" />
          </div>
        </div>
      )}
    </div>
  )
}

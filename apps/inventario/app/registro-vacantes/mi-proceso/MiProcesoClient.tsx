'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  Loader2, LogIn, Check, PenLine, FileCheck2, Upload, ClipboardCheck, ArrowRight, MapPin, X, AlertTriangle, Eye, Building2, LogOut, Camera,
} from 'lucide-react'
import { toast } from 'sonner'
import { getSupabase } from '@/lib/supabase/anon'
import { FASES_PUBLICAS, faseMeta, esCorte } from '@/lib/ats/fases'
import { htmlParaMostrar } from '@/lib/documentos/html'
import { VisorDocumento } from '@/components/documentos/VisorDocumento'
import { PadFirma } from '@/components/firma/PadFirma'
import { BotonesFoto } from '@/components/foto/BotonesFoto'
import { subirDocumento, tipoAplica, fetchCargoFlags, marcarFotoPerfil, eliminarDocumento, type DocumentoSubido } from '@/lib/registro/documentos'
import type { TipoDocumental } from '@/lib/registro/tipos'

/* eslint-disable @typescript-eslint/no-explicit-any */

type Fase = 'cargando' | 'sin_sesion' | 'sin_registro' | 'listo'

export function MiProcesoClient() {
  const sb = useMemo(() => getSupabase(), [])
  const [fase, setFase] = useState<Fase>('cargando')
  const [c, setC] = useState<any>(null)
  const [cargo, setCargo] = useState<string>('')
  const [pruebas, setPruebas] = useState<any[]>([])
  const [docs, setDocs] = useState<any[]>([])
  const [tipos, setTipos] = useState<TipoDocumental[]>([])
  const [mios, setMios] = useState<any[]>([])
  const [empresa, setEmpresa] = useState<any>(null)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [firmando, setFirmando] = useState<any | null>(null)
  const [viendo, setViendo] = useState<{ titulo: string; cuerpo: string } | null>(null)
  const [cambiandoFoto, setCambiandoFoto] = useState(false)

  const cargar = useCallback(async () => {
    const { data: s } = await sb.auth.getSession()
    if (!s.session?.user) { setFase('sin_sesion'); return }
    const { data: cand } = await sb.from('candidatos').select('*').eq('auth_uid', s.session.user.id)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (!cand) { setFase('sin_registro'); return }
    if (cand.estado === 'BORRADOR') { window.location.href = '/registro-vacantes'; return }
    setC(cand)
    const flags = cand.cargo_postulacion_id ? await fetchCargoFlags(cand.cargo_postulacion_id) : {}
    const [cg, pr, gen, t1, t2, t3, mis, emp, foto] = await Promise.all([
      cand.cargo_postulacion_id ? sb.from('cargos').select('nombre').eq('id', cand.cargo_postulacion_id).maybeSingle() : Promise.resolve({ data: null }),
      sb.rpc('vac_pruebas_de_candidato', { p_candidato: cand.id }),
      sb.from('documentos_generados').select('id, nombre, estado, permite_firma_electronica, firmado_at, metodo_firma, generado_at')
        .eq('candidato_id', cand.id).neq('estado', 'ANULADO').order('generado_at'),
      sb.from('vac_tipos_documentales').select('*').eq('ola', 1).order('orden'),
      sb.from('vac_tipos_documentales').select('*').eq('ola', 2).order('orden'),
      sb.from('vac_tipos_documentales').select('*').eq('ola', 3).eq('sube_staff', false).order('orden'),
      sb.from('candidato_documentos').select('id, tipo_documental_id, orden, storage_path, mime, estado, motivo_rechazo, nombre_original').eq('candidato_id', cand.id),
      sb.from('vac_empresa').select('razon_social, direccion, ciudad, telefono, correo_seleccion').eq('id', 1).maybeSingle(),
      cand.foto_perfil_path ? sb.storage.from('registro-vacantes').createSignedUrl(cand.foto_perfil_path, 1800) : Promise.resolve({ data: null }),
    ])
    setCargo(cg.data?.nombre ?? '')
    setPruebas((pr.data ?? []) as any[])
    setDocs(gen.data ?? [])
    const todos = [...(t1.data ?? []), ...(t2.data ?? []), ...(t3.data ?? [])] as TipoDocumental[]
    setTipos(todos.filter((t) => t.activo !== false && tipoAplica(t, flags)))
    setMios(mis.data ?? [])
    setEmpresa(emp.data)
    setFotoUrl((foto as any).data?.signedUrl ?? null)
    setFase('listo')
  }, [sb])

  useEffect(() => { void cargar() }, [cargar])

  async function abrir(doc: any, paraFirmar: boolean) {
    const { data, error } = await sb.from('documentos_generados').select('id, nombre, html_render, html_firmado, firma_evidencia, sha256, estado, permite_firma_electronica').eq('id', doc.id).single()
    if (error || !data) { toast.error('No se pudo abrir el documento.'); return }
    const cuerpo = htmlParaMostrar(data, { fotoUrl })
    if (paraFirmar) setFirmando({ ...data, cuerpo })
    else setViendo({ titulo: data.nombre, cuerpo })
  }

  async function salir() {
    await sb.auth.signOut()
    window.location.href = '/ingresar'
  }

  // Foto de perfil nueva: queda como documento (RRHH la revisa) y como la foto
  // que sale en los formatos. Las anteriores sin validar se reemplazan; una ya
  // validada se conserva como historial del expediente.
  async function guardarFoto(file: File) {
    const tipo = tipos.find((t) => t.codigo === 'FOTO_CARNET')
    if (!tipo || !c) { toast.error('No se pudo guardar la foto. Intenta más tarde.'); return }
    const previas = mios.filter((m) => m.tipo_documental_id === tipo.id)
    const r = await subirDocumento(c.id, tipo, file, previas.length + 1)
    if (r.error || !r.doc) { toast.error(r.error ?? 'No se pudo guardar la foto.'); return }
    await marcarFotoPerfil(c.id, r.doc.storage_path)
    for (const p of previas.filter((m) => m.estado !== 'VALIDADO')) {
      try { await eliminarDocumento(p as DocumentoSubido) } catch { /* queda en el historial */ }
    }
    setCambiandoFoto(false)
    toast.success('Foto de perfil actualizada.')
    await cargar()
  }

  if (fase === 'cargando') return <div className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-brand-green" /></div>
  if (fase !== 'listo' || !c) {
    return (
      <div className="rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-gray-100">
        <p className="font-heading text-lg font-bold text-gray-900">{fase === 'sin_sesion' ? 'Ingresa para ver tu proceso' : 'Aún no tienes un registro'}</p>
        <p className="mt-2 text-sm text-gray-500">{fase === 'sin_sesion' ? 'Usa tu número de documento y tu contraseña.' : 'Regístrate para postularte a nuestras vacantes.'}</p>
        <Link href={fase === 'sin_sesion' ? '/ingresar' : '/registro-vacantes'} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 font-semibold text-white hover:bg-brand-green-dark">
          <LogIn className="h-4 w-4" /> {fase === 'sin_sesion' ? 'Ingresar' : 'Registrarme'}
        </Link>
      </div>
    )
  }

  const meta = faseMeta(c.estado)
  const corte = esCorte(c.estado)
  const pruebasPend = pruebas.filter((p) => p.obligatoria && (!p.intento_estado || p.intento_estado === 'EN_CURSO'))
  const porFirmar = docs.filter((d) => d.estado === 'PENDIENTE_FIRMA')
  const firmados = docs.filter((d) => d.estado === 'FIRMADO' || d.estado === 'GENERADO')
  const cuenta = (tipoId: string) => mios.filter((m) => m.tipo_documental_id === tipoId && m.estado !== 'RECHAZADO').length
  // Rechazados que aún no se han reemplazado por un archivo nuevo del mismo tipo.
  const rechazados = mios.filter((m) => m.estado === 'RECHAZADO' && cuenta(m.tipo_documental_id) === 0)
  // Lo que falta: obligatorios del registro sin archivo, y los de vinculación cuando ya va en exámenes o después.
  const avanzado = meta.publica >= 4
  const faltan = tipos.filter((t) => {
    const n = cuenta(t.id)
    if (t.ola === 1) return t.obligatorio && n < Math.max(1, t.min_archivos)
    return avanzado && n < Math.max(1, t.min_archivos) && t.obligatorio
  })
  const opcionalesVinculacion = avanzado ? tipos.filter((t) => t.ola > 1 && !t.obligatorio && cuenta(t.id) === 0) : []

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setCambiandoFoto((v) => !v)} className="relative shrink-0" aria-label="Cambiar mi foto de perfil" title="Cambiar mi foto de perfil">
              {fotoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={fotoUrl} alt="" className="h-16 w-12 rounded-lg object-cover ring-1 ring-gray-200" />
                : <div className="flex h-16 w-12 items-center justify-center rounded-lg bg-brand-green/10 font-heading text-xl font-bold text-brand-green">{(c.nombres ?? '?').charAt(0)}</div>}
              <span className="absolute -bottom-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-brand-green text-white ring-2 ring-white">
                <Camera className="h-3.5 w-3.5" />
              </span>
            </button>
            <div>
              <p className="font-heading text-lg font-bold text-gray-900">Hola, {c.primer_nombre ?? c.nombres}</p>
              <p className="text-sm text-gray-500">Candidato(a) para <strong>{cargo || 'el cargo que elegiste'}</strong></p>
            </div>
          </div>
          <button onClick={salir} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-400 hover:text-gray-600"><LogOut className="h-3.5 w-3.5" /> Salir</button>
        </div>

        {cambiandoFoto && (
          <div className="mt-4 rounded-xl border border-brand-green/30 bg-brand-green/5 p-3">
            <p className="text-sm font-semibold text-gray-800">{fotoUrl ? 'Cambiar mi foto de perfil' : 'Agrega tu foto de perfil'}</p>
            <p className="mb-2 mt-0.5 text-xs text-gray-500">Tipo carné: de frente, con buena luz y fondo claro. Sale en tu hoja de vida y en tus formatos.</p>
            <BotonesFoto onFoto={guardarFoto} compacto />
          </div>
        )}

        {corte ? (
          <p className="mt-4 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
            {c.estado === 'BANCO_TALENTO'
              ? 'Tu hoja de vida quedó en nuestro banco de talento. Te contactaremos cuando haya una vacante para tu perfil.'
              : 'Tu proceso para esta vacante terminó. Gracias por tu interés; puedes volver a postularte más adelante.'}
          </p>
        ) : (
          <ol className="mt-5 grid grid-cols-5 gap-1">
            {FASES_PUBLICAS.map((f) => {
              const hecho = meta.publica > f.n || ['CONTRATADO', 'ACTIVO'].includes(c.estado)
              const actual = meta.publica === f.n && !['CONTRATADO', 'ACTIVO'].includes(c.estado)
              return (
                <li key={f.n} className="text-center">
                  <div className={'mx-auto flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ' +
                    (hecho ? 'bg-brand-green text-white' : actual ? 'bg-brand-green/15 text-brand-green ring-2 ring-brand-green' : 'bg-gray-100 text-gray-400')}>
                    {hecho ? <Check className="h-4 w-4" /> : f.n}
                  </div>
                  <p className={'mt-1 text-[11px] leading-tight ' + (actual ? 'font-bold text-brand-green' : 'text-gray-500')}>{f.label}</p>
                </li>
              )
            })}
          </ol>
        )}
        {!corte && <p className="mt-3 text-center text-xs text-gray-500">{['CONTRATADO', 'ACTIVO'].includes(c.estado) ? '¡Bienvenido(a) al equipo!' : `Fase actual en progreso: ${meta.descripcion}`}</p>}
      </div>

      {/* Pruebas pendientes */}
      {!corte && pruebasPend.length > 0 && (
        <div className="rounded-2xl border-2 border-brand-green/30 bg-brand-green/5 p-5">
          <p className="flex items-center gap-2 font-heading font-bold text-gray-900"><ClipboardCheck className="h-5 w-5 text-brand-green" /> Te faltan {pruebasPend.length} prueba(s) de selección</p>
          <Link href="/registro-vacantes/pruebas" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-brand-green px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-green-dark">
            Presentar las pruebas <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      )}

      {/* Documentos para firmar */}
      {porFirmar.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-amber-200">
          <p className="flex items-center gap-2 font-heading font-bold text-gray-900"><PenLine className="h-5 w-5 text-amber-600" /> Documentos para firmar ({porFirmar.length})</p>
          <p className="mt-1 text-sm text-gray-500">Ya vienen llenos con tus datos. Léelos y fírmalos con el dedo.</p>
          <ul className="mt-3 space-y-2">
            {porFirmar.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2.5">
                <span className="text-sm font-medium text-gray-800">{d.nombre}</span>
                {d.permite_firma_electronica ? (
                  <button onClick={() => abrir(d, true)} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-brand-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-green-dark">
                    <PenLine className="h-3.5 w-3.5" /> Leer y firmar
                  </button>
                ) : (
                  <span className="flex shrink-0 items-center gap-1 text-xs text-gray-500"><Building2 className="h-3.5 w-3.5" /> Se firma en la oficina</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Documentos que faltan / rechazados */}
      {(faltan.length > 0 || rechazados.length > 0 || opcionalesVinculacion.length > 0) && !corte && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
          <p className="flex items-center gap-2 font-heading font-bold text-gray-900"><Upload className="h-5 w-5 text-brand-green" /> Documentos por subir</p>
          {rechazados.length > 0 && (
            <div className="mt-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
              <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-4 w-4" /> Debes volver a subir:</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {rechazados.map((r) => <li key={r.id}>{tipos.find((t) => t.id === r.tipo_documental_id)?.nombre ?? 'Documento'}: {r.motivo_rechazo}</li>)}
              </ul>
            </div>
          )}
          <ul className="mt-3 space-y-2">
            {[...faltan, ...opcionalesVinculacion].map((t) => t.codigo === 'FOTO_CARNET' ? (
              <li key={t.id} className="rounded-xl border border-gray-100 px-3 py-2.5">
                <p className="text-sm font-medium text-gray-800">{t.nombre} {t.obligatorio && <span className="text-red-500">*</span>}</p>
                {t.descripcion && <p className="mb-2 text-xs text-gray-500">{t.descripcion}</p>}
                <BotonesFoto onFoto={guardarFoto} compacto />
              </li>
            ) : (
              <SubirTipo key={t.id} tipo={t} candidatoId={c.id} cantidad={cuenta(t.id)} onSubido={cargar} />
            ))}
          </ul>
        </div>
      )}

      {/* Firmados */}
      {firmados.length > 0 && (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-100">
          <p className="flex items-center gap-2 font-heading font-bold text-gray-900"><FileCheck2 className="h-5 w-5 text-green-600" /> Mis documentos</p>
          <ul className="mt-3 space-y-1.5">
            {firmados.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2">
                <span className="text-sm text-gray-700">{d.nombre}{d.estado === 'FIRMADO' && <span className="ml-1 text-xs text-green-700">· firmado</span>}</span>
                <button onClick={() => abrir(d, false)} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-green"><Eye className="h-3.5 w-3.5" /> Ver</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl bg-brand-green-bg/60 p-4 text-sm text-gray-600">
        <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-brand-green" /> {empresa?.razon_social}: {empresa?.direccion}, {empresa?.ciudad}.</p>
        <p className="mt-1">Recibirás notificaciones por correo cuando haya novedades en tu proceso.{empresa?.correo_seleccion ? ` Si tienes preguntas escribe a ${empresa.correo_seleccion}.` : ''}</p>
      </div>

      {viendo && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <p className="truncate font-heading font-bold text-gray-900">{viendo.titulo}</p>
            <button onClick={() => setViendo(null)} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100" aria-label="Cerrar"><X className="h-5 w-5" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3"><VisorDocumento cuerpo={viendo.cuerpo} titulo={viendo.titulo} alturaMax="none" /></div>
        </div>
      )}

      {firmando && (
        <Firmar doc={firmando} onCerrar={() => setFirmando(null)} onFirmado={async () => { setFirmando(null); toast.success('¡Documento firmado!'); await cargar() }} />
      )}
    </div>
  )
}

function Firmar({ doc, onCerrar, onFirmado }: { doc: any; onCerrar: () => void; onFirmado: () => void }) {
  const sb = useMemo(() => getSupabase(), [])
  const [leido, setLeido] = useState(false)
  const [firma, setFirma] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  async function firmar() {
    if (!firma) { toast.error('Dibuja tu firma.'); return }
    setEnviando(true)
    const { error } = await sb.rpc('vac_firmar_documento', { p_doc: doc.id, p_firma_data_url: firma, p_user_agent: navigator.userAgent })
    setEnviando(false)
    if (error) { toast.error(error.message); return }
    onFirmado()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <p className="truncate font-heading font-bold text-gray-900">{doc.nombre}</p>
        <button onClick={onCerrar} className="rounded-lg p-1 text-gray-500 hover:bg-gray-100" aria-label="Cerrar"><X className="h-5 w-5" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <VisorDocumento cuerpo={doc.cuerpo} titulo={doc.nombre} alturaMax="none" mostrarImprimir={false} />
      </div>
      <div className="space-y-3 border-t border-gray-100 bg-gray-50 p-4">
        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={leido} onChange={(e) => setLeido(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[#2E7D32]" />
          Leí el documento, los datos son correctos y estoy de acuerdo con su contenido.
        </label>
        {leido && <PadFirma onCambio={setFirma} alto={160} />}
        <p className="text-[11px] text-gray-500">Tu firma queda con la fecha, la hora y el equipo desde donde firmas (firma electrónica, Ley 527 de 1999).</p>
        <button type="button" onClick={firmar} disabled={!leido || !firma || enviando}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-green py-3 font-semibold text-white hover:bg-brand-green-dark disabled:opacity-50">
          {enviando ? <Loader2 className="h-5 w-5 animate-spin" /> : <PenLine className="h-5 w-5" />} Firmar documento
        </button>
      </div>
    </div>
  )
}

function SubirTipo({ tipo, candidatoId, cantidad, onSubido }: { tipo: TipoDocumental; candidatoId: string; cantidad: number; onSubido: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const [subiendo, setSubiendo] = useState(false)
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-100 px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-800">{tipo.nombre} {tipo.obligatorio && <span className="text-red-500">*</span>}</p>
        {tipo.descripcion && <p className="text-xs text-gray-500">{tipo.descripcion}</p>}
      </div>
      <button type="button" onClick={() => ref.current?.click()} disabled={subiendo}
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-brand-green/50 px-3 py-1.5 text-xs font-semibold text-brand-green disabled:opacity-50">
        {subiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Subir
      </button>
      <input ref={ref} type="file" hidden accept="image/*,application/pdf,.heic,.doc,.docx" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = ''
        if (!f) return
        setSubiendo(true)
        const r = await subirDocumento(candidatoId, tipo, f, cantidad + 1)
        setSubiendo(false)
        if (r.error) { toast.error(r.error); return }
        toast.success('Documento cargado.')
        onSubido()
      }} />
    </li>
  )
}

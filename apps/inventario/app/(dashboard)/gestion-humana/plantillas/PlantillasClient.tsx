'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  FileText, Plus, Save, History, Eye, Download, Upload, Loader2, Copy, AlertTriangle, Search, RotateCcw, UserRound, Braces,
} from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { usePermisos } from '@/components/permisos/PermisosProvider'
import { VisorDocumento } from '@/components/documentos/VisorDocumento'
import { extraerVariables, renderizarPlantilla, marcadoresReservados } from '@/lib/documentos/plantilla'
import { limpiarHtml, resolverMarcadores } from '@/lib/documentos/html'
import { GRUPOS_VARIABLES, MARCADORES_DOC, FILTROS_DOC, RUTAS_CONOCIDAS, contextoDeEjemplo } from '@/lib/documentos/variables'
import { Modal, Boton, Badge, Campo, inputCls, fechaHora } from '../postulaciones/ui'

/* eslint-disable @typescript-eslint/no-explicit-any */

const MOMENTOS: Record<string, string> = { SELECCION: 'Selección', CONTRATACION: 'Contratación e ingreso', INGRESO: 'Ingreso', INTERNO: 'Uso interno' }
const CATEGORIAS = ['CONTRATO', 'AUTORIZACION', 'FORMATO', 'CONSTANCIA', 'CARTA', 'HOJA_VIDA', 'REQUISICION']

const ESQUELETO = `<div class="hoja">
  <table class="encabezado">
    <tr>
      <td class="logo" rowspan="2"><img src="/logo-horizontal.png" alt="Conserjes Inmobiliarios"></td>
      <td class="titulo" rowspan="2">TÍTULO DEL FORMATO</td>
      <td class="version">Versión: 1</td>
    </tr>
    <tr><td class="version">Fecha: {{hoy.fecha}}</td></tr>
  </table>

  <p>Yo <strong>{{candidato.nombre_completo}}</strong>, identificado(a) con cédula de ciudadanía No. <strong>{{candidato.numero_documento}}</strong> expedida en {{candidato.lugar_expedicion_doc}}, …</p>

  <table class="firmas">
    <tr><td><strong>FIRMA:</strong> {{FIRMA_TRABAJADOR}}</td><td><strong>C.C.:</strong> {{candidato.numero_documento}}</td></tr>
  </table>
</div>
`

async function sha256Texto(t: string): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function PlantillasClient({
  plantillas, versiones, candidatos, cargos,
}: { plantillas: any[]; versiones: any[]; candidatos: any[]; cargos: any[] }) {
  const router = useRouter()
  const { puede } = usePermisos()
  const puedeEditar = puede('gestionar_plantillas_documento')
  const [sb] = useState<any>(() => createClient())
  const [selId, setSelId] = useState<string | null>(plantillas[0]?.id ?? null)
  const sel = plantillas.find((p) => p.id === selId) ?? null
  const versionesDe = (id: string) => versiones.filter((v) => v.plantilla_id === id)

  const [meta, setMeta] = useState<any>(sel)
  const [cuerpo, setCuerpo] = useState('')
  const [cuerpoBase, setCuerpoBase] = useState('')
  const [versionVista, setVersionVista] = useState<number | null>(null)
  const [cargando, setCargando] = useState(false)
  const [notas, setNotas] = useState('')
  const [guardando, setGuardando] = useState<string | null>(null)
  const [vista, setVista] = useState<'editar' | 'previa'>('editar')
  const [candidatoPrueba, setCandidatoPrueba] = useState('')
  const [previaReal, setPreviaReal] = useState<{ html: string; vacias: string[] } | null>(null)
  const [buscarVar, setBuscarVar] = useState('')
  const [nueva, setNueva] = useState<null | { codigo: string; nombre: string; momento: string; categoria: string; duplicar: boolean }>(null)
  const area = useRef<HTMLTextAreaElement>(null)

  // Carga el cuerpo de la versión vigente al cambiar de plantilla.
  useEffect(() => {
    if (!sel) return
    setMeta(sel)
    setPreviaReal(null)
    setNotas('')
    void cargarVersion(sel.version_vigente)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId])

  async function cargarVersion(version: number) {
    if (!sel) return
    setCargando(true)
    const { data } = await sb.from('plantilla_versiones').select('cuerpo_html').eq('plantilla_id', sel.id).eq('version', version).maybeSingle()
    setCargando(false)
    setCuerpo(data?.cuerpo_html ?? '')
    setCuerpoBase(data?.cuerpo_html ?? '')
    setVersionVista(version)
  }

  const variables = useMemo(() => extraerVariables(cuerpo), [cuerpo])
  const desconocidas = useMemo(
    () => variables.filter((v) => !RUTAS_CONOCIDAS.has(v) && !/^(extras|formato|requisicion|empresa|hoy)\./.test(v) && !/^(candidato|cargo|contrato|entrevista)\.[a-z_]+\.[a-z_]+$/.test(v)),
    [variables],
  )
  const marcadores = useMemo(() => marcadoresReservados(cuerpo), [cuerpo])
  const cambiado = cuerpo !== cuerpoBase

  const previaEjemplo = useMemo(() => {
    if (vista !== 'previa') return ''
    try { return resolverMarcadores(limpiarHtml(renderizarPlantilla(cuerpo, contextoDeEjemplo()))) }
    catch (e) { return `<p style="color:#b91c1c">Error en la plantilla: ${String(e)}</p>` }
  }, [cuerpo, vista])

  function insertar(texto: string) {
    const el = area.current
    if (!el) { setCuerpo((c) => c + texto); return }
    const { selectionStart: a, selectionEnd: b } = el
    const nuevo = cuerpo.slice(0, a) + texto + cuerpo.slice(b)
    setCuerpo(nuevo)
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = a + texto.length })
  }

  async function probarConCandidato() {
    if (!candidatoPrueba) { toast.error('Elija un candidato.'); return }
    setGuardando('probar')
    const res = await fetch('/api/gestion-humana/documentos/generar', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidato_id: candidatoPrueba, vista_previa: true, plantilla_html: cuerpo }),
    })
    const j = await res.json().catch(() => ({}))
    setGuardando(null)
    if (!res.ok) { toast.error(j.error ?? 'No se pudo probar.'); return }
    setPreviaReal({ html: resolverMarcadores(j.html), vacias: j.vacias ?? [] })
  }

  async function publicar() {
    if (!sel) return
    if (!cuerpo.trim()) { toast.error('La plantilla está vacía.'); return }
    setGuardando('publicar')
    const { data: { user } } = await sb.auth.getUser()
    const { data: yo } = user ? await sb.from('usuarios').select('nombre, email').eq('id', user.id).maybeSingle() : { data: null }
    const max = Math.max(0, ...versionesDe(sel.id).map((v) => v.version))
    const { error } = await sb.from('plantilla_versiones').insert({
      plantilla_id: sel.id, version: max + 1, cuerpo_html: cuerpo, variables, notas: notas.trim() || null,
      sha256: await sha256Texto(cuerpo), publicada: true, creado_por: user?.id ?? null, creado_por_nombre: yo?.nombre ?? yo?.email ?? null,
    })
    setGuardando(null)
    if (error) { toast.error(error.message); return }
    toast.success(`Versión ${max + 1} publicada. Los documentos nuevos se generan con ella; los ya generados conservan su versión.`)
    setNotas('')
    router.refresh()
    setCuerpoBase(cuerpo)
    setVersionVista(max + 1)
  }

  async function guardarMeta() {
    if (!sel || !meta) return
    setGuardando('meta')
    const { error } = await sb.from('plantillas_documento').update({
      nombre: meta.nombre, descripcion: meta.descripcion || null, categoria: meta.categoria, momento: meta.momento,
      orden: Number(meta.orden) || 0, codigo_formato: meta.codigo_formato || null, obligatoria: !!meta.obligatoria, activa: !!meta.activa,
      requiere_firma_trabajador: !!meta.requiere_firma_trabajador, requiere_firma_empleador: !!meta.requiere_firma_empleador,
      requiere_testigos: !!meta.requiere_testigos, requiere_huella: !!meta.requiere_huella, requiere_contrato: !!meta.requiere_contrato,
      visible_candidato: !!meta.visible_candidato, permite_firma_electronica: !!meta.permite_firma_electronica,
      aplica_cargos: meta.aplica_cargos?.length ? meta.aplica_cargos : null,
    }).eq('id', sel.id)
    setGuardando(null)
    if (error) { toast.error(error.message); return }
    toast.success('Datos de la plantilla guardados.')
    router.refresh()
  }

  async function descargarOriginal() {
    if (!sel?.archivo_original_path) return
    const { data, error } = await sb.storage.from('plantillas-documentos').createSignedUrl(sel.archivo_original_path, 120, { download: sel.archivo_original_nombre ?? true })
    if (error || !data?.signedUrl) { toast.error('No se pudo descargar el original.'); return }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  async function subirOriginal(file: File) {
    if (!sel) return
    setGuardando('original')
    const ext = (file.name.split('.').pop() || 'docx').toLowerCase()
    const path = `${sel.codigo}/original.${ext}`
    const up = await sb.storage.from('plantillas-documentos').upload(path, file, { upsert: true, contentType: file.type || undefined })
    if (!up.error) await sb.from('plantillas_documento').update({ archivo_original_path: path, archivo_original_nombre: file.name }).eq('id', sel.id)
    setGuardando(null)
    if (up.error) { toast.error(up.error.message); return }
    toast.success('Archivo original actualizado.')
    router.refresh()
  }

  async function crear() {
    if (!nueva) return
    const codigo = nueva.codigo.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_')
    if (!codigo || !nueva.nombre.trim()) { toast.error('Código y nombre son obligatorios.'); return }
    setGuardando('crear')
    const base = nueva.duplicar && sel ? { ...sel } : {}
    const { data: pl, error } = await sb.from('plantillas_documento').insert({
      ...(nueva.duplicar && sel ? {
        descripcion: base.descripcion, obligatoria: base.obligatoria, requiere_firma_trabajador: base.requiere_firma_trabajador,
        requiere_firma_empleador: base.requiere_firma_empleador, requiere_testigos: base.requiere_testigos, requiere_huella: base.requiere_huella,
        requiere_contrato: base.requiere_contrato, visible_candidato: base.visible_candidato, permite_firma_electronica: base.permite_firma_electronica,
        codigo_formato: base.codigo_formato,
      } : {}),
      codigo, nombre: nueva.nombre.trim(), momento: nueva.momento, categoria: nueva.categoria, orden: 100, activa: true,
    }).select('id').single()
    if (error) { setGuardando(null); toast.error(error.message.includes('duplicate') ? 'Ya existe una plantilla con ese código.' : error.message); return }
    const html = nueva.duplicar ? cuerpo : ESQUELETO
    const { data: { user } } = await sb.auth.getUser()
    await sb.from('plantilla_versiones').insert({
      plantilla_id: pl.id, version: 1, cuerpo_html: html, variables: extraerVariables(html), publicada: true,
      notas: nueva.duplicar ? `Duplicada de ${sel?.codigo}` : 'Plantilla nueva', sha256: await sha256Texto(html), creado_por: user?.id ?? null,
    })
    setGuardando(null)
    toast.success('Plantilla creada.')
    setNueva(null)
    router.refresh()
    setSelId(pl.id)
  }

  const grupos = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const p of plantillas) m.set(p.momento, [...(m.get(p.momento) ?? []), p])
    return [...m.entries()]
  }, [plantillas])

  const varsFiltradas = useMemo(() => {
    const q = buscarVar.trim().toLowerCase()
    return GRUPOS_VARIABLES.map((g) => ({
      ...g, variables: g.variables.filter((v) => !q || v.ruta.toLowerCase().includes(q) || v.descripcion.toLowerCase().includes(q)),
    })).filter((g) => g.variables.length)
  }, [buscarVar])

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* Lista de plantillas */}
      <aside className="space-y-3">
        {puedeEditar && (
          <Boton className="w-full" onClick={() => setNueva({ codigo: '', nombre: '', momento: 'CONTRATACION', categoria: 'FORMATO', duplicar: false })}>
            <Plus className="h-4 w-4" /> Nueva plantilla
          </Boton>
        )}
        {grupos.map(([momento, lista]) => (
          <div key={momento}>
            <p className="mb-1 px-1 text-[11px] font-bold uppercase tracking-wide text-gray-400">{MOMENTOS[momento] ?? momento}</p>
            <ul className="space-y-1">
              {lista.map((p) => (
                <li key={p.id}>
                  <button onClick={() => setSelId(p.id)}
                    className={'w-full rounded-lg border px-2.5 py-2 text-left text-sm transition-colors ' +
                      (p.id === selId ? 'border-brand-green bg-brand-green/5' : 'border-gray-100 bg-white hover:border-brand-green/40')}>
                    <span className="flex items-start justify-between gap-1">
                      <span className={'font-medium ' + (p.activa ? 'text-gray-800' : 'text-gray-400 line-through')}>{p.nombre}</span>
                      <span className="shrink-0 text-[11px] text-gray-400">v{p.version_vigente}</span>
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-1">
                      {!p.requiere_firma_trabajador && <Badge className="bg-gray-100 text-gray-500">Sin firma</Badge>}
                      {!p.permite_firma_electronica && <Badge className="bg-amber-50 text-amber-700">Papel</Badge>}
                      {!p.visible_candidato && <Badge className="bg-violet-50 text-violet-700">Interno</Badge>}
                      {p.requiere_contrato && <Badge className="bg-lime-50 text-lime-800">Contrato</Badge>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </aside>

      {/* Editor */}
      {!sel || !meta ? (
        <p className="rounded-xl bg-white p-6 text-sm text-gray-400">Seleccione una plantilla.</p>
      ) : (
        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-mono text-xs text-gray-400">{sel.codigo}</p>
                <h2 className="font-heading text-lg font-bold text-gray-900">{sel.nombre}</h2>
                {sel.codigo_formato && <p className="text-xs text-gray-500">Formato físico: {sel.codigo_formato}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {sel.archivo_original_path && <Boton variante="secundario" onClick={descargarOriginal}><Download className="h-4 w-4" /> Original ({sel.archivo_original_nombre})</Boton>}
                {puedeEditar && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                    {guardando === 'original' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {sel.archivo_original_path ? 'Reemplazar original' : 'Subir original'}
                    <input type="file" hidden accept=".doc,.docx,.xls,.xlsx,.pdf" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void subirOriginal(f) }} />
                  </label>
                )}
                {puedeEditar && <Boton variante="secundario" onClick={() => setNueva({ codigo: `${sel.codigo}_COPIA`, nombre: `${sel.nombre} (copia)`, momento: sel.momento, categoria: sel.categoria, duplicar: true })}><Copy className="h-4 w-4" /> Duplicar</Boton>}
              </div>
            </div>
            {sel.descripcion && <p className="mt-2 text-sm text-gray-600">{sel.descripcion}</p>}

            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-brand-green">Datos y reglas de la plantilla</summary>
              <fieldset disabled={!puedeEditar} className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Campo label="Nombre"><input value={meta.nombre ?? ''} onChange={(e) => setMeta({ ...meta, nombre: e.target.value })} className={inputCls} /></Campo>
                  <Campo label="Momento">
                    <select value={meta.momento} onChange={(e) => setMeta({ ...meta, momento: e.target.value })} className={inputCls}>
                      {Object.entries(MOMENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Categoría">
                    <select value={meta.categoria} onChange={(e) => setMeta({ ...meta, categoria: e.target.value })} className={inputCls}>
                      {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
                    </select>
                  </Campo>
                  <Campo label="Orden"><input type="number" value={meta.orden ?? 0} onChange={(e) => setMeta({ ...meta, orden: e.target.value })} className={inputCls} /></Campo>
                </div>
                <Campo label="Descripción (se muestra a RRHH)"><textarea rows={2} value={meta.descripcion ?? ''} onChange={(e) => setMeta({ ...meta, descripcion: e.target.value })} className={inputCls} /></Campo>
                <Campo label="Código / versión del formato físico"><input value={meta.codigo_formato ?? ''} onChange={(e) => setMeta({ ...meta, codigo_formato: e.target.value })} className={inputCls} /></Campo>
                <div className="grid gap-2 text-sm text-gray-700 sm:grid-cols-3">
                  {[
                    ['activa', 'Activa'], ['obligatoria', 'Se genera por defecto'], ['requiere_firma_trabajador', 'La firma el trabajador'],
                    ['permite_firma_electronica', 'Se puede firmar en la plataforma'], ['visible_candidato', 'El candidato la ve'],
                    ['requiere_contrato', 'Necesita el contrato'], ['requiere_huella', 'Lleva huella'], ['requiere_firma_empleador', 'Firma el empleador'],
                    ['requiere_testigos', 'Lleva testigos'],
                  ].map(([k, l]) => (
                    <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={!!meta[k]} onChange={(e) => setMeta({ ...meta, [k]: e.target.checked })} className="h-4 w-4 accent-[#2E7D32]" /> {l}</label>
                  ))}
                </div>
                <Campo label="Solo para estos cargos (vacío = todos)">
                  <select multiple value={meta.aplica_cargos ?? []} onChange={(e) => setMeta({ ...meta, aplica_cargos: [...e.target.selectedOptions].map((o) => o.value) })} className={inputCls + ' h-28'}>
                    {cargos.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </select>
                </Campo>
                {puedeEditar && <Boton variante="secundario" onClick={guardarMeta} disabled={guardando === 'meta'}>{guardando === 'meta' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Guardar datos</Boton>}
              </fieldset>
            </details>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex rounded-lg border border-gray-200 bg-white p-0.5 text-sm">
                  {(['editar', 'previa'] as const).map((v) => (
                    <button key={v} onClick={() => setVista(v)} className={'rounded-md px-3 py-1.5 font-semibold ' + (vista === v ? 'bg-brand-green text-white' : 'text-gray-600')}>
                      {v === 'editar' ? 'Editar HTML' : 'Vista previa (datos de ejemplo)'}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-500">
                  Viendo v{versionVista}{versionVista !== sel.version_vigente ? ` (vigente: v${sel.version_vigente})` : ' · vigente'}{cambiado ? ' · con cambios sin publicar' : ''}
                </span>
              </div>

              {cargando ? (
                <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand-green" /></div>
              ) : vista === 'editar' ? (
                <textarea ref={area} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} spellCheck={false} readOnly={!puedeEditar}
                  className="h-[60vh] w-full rounded-xl border border-gray-200 bg-white p-3 font-mono text-xs leading-relaxed text-gray-800 outline-none focus:border-brand-green" />
              ) : (
                <VisorDocumento cuerpo={previaEjemplo} titulo={sel.nombre} alturaMax="62vh" />
              )}

              {desconocidas.length > 0 && (
                <p className="flex items-start gap-1.5 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Variables que no están en el catálogo (saldrán vacías): {desconocidas.join(', ')}
                </p>
              )}
              <p className="text-[11px] text-gray-400">
                Usa {variables.length} variable(s){marcadores.length ? ` y los marcadores ${marcadores.map((m) => `{{${m}}}`).join(', ')}` : ''}.
              </p>

              {puedeEditar && (
                <div className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-white p-3">
                  <div className="min-w-[240px] flex-1">
                    <Campo label="Notas de la versión (qué cambió)"><input value={notas} onChange={(e) => setNotas(e.target.value)} className={inputCls} placeholder="Ej.: se actualizó la cláusula sexta" /></Campo>
                  </div>
                  <Boton onClick={publicar} disabled={!cambiado || guardando === 'publicar'}>
                    {guardando === 'publicar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Publicar versión {Math.max(0, ...versionesDe(sel.id).map((v) => v.version)) + 1}
                  </Boton>
                  {cambiado && <Boton variante="secundario" onClick={() => setCuerpo(cuerpoBase)}><RotateCcw className="h-4 w-4" /> Descartar cambios</Boton>}
                </div>
              )}

              {/* Probar con un candidato real */}
              <div className="rounded-xl border border-gray-100 bg-white p-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800"><UserRound className="h-4 w-4 text-brand-green" /> Probar con un candidato real</p>
                <div className="flex flex-wrap gap-2">
                  <select value={candidatoPrueba} onChange={(e) => setCandidatoPrueba(e.target.value)} className={inputCls + ' max-w-md'}>
                    <option value="">— Elija un candidato —</option>
                    {candidatos.map((c) => <option key={c.id} value={c.id}>{c.nombres} {c.apellidos} · {c.numero_documento}</option>)}
                  </select>
                  <Boton variante="secundario" onClick={probarConCandidato} disabled={!candidatoPrueba || guardando === 'probar'}>
                    {guardando === 'probar' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />} Ver cómo queda
                  </Boton>
                </div>
                <p className="mt-1 text-[11px] text-gray-400">No guarda nada: muestra el texto que está en el editor llenado con los datos del candidato.</p>
                {previaReal && (
                  <div className="mt-3 space-y-2">
                    {previaReal.vacias.length > 0 && <p className="text-xs text-amber-700">Quedarían vacíos: {previaReal.vacias.join(', ')}</p>}
                    <VisorDocumento cuerpo={previaReal.html} titulo={sel.nombre} alturaMax="60vh" />
                  </div>
                )}
              </div>
            </div>

            {/* Panel lateral: variables y versiones */}
            <aside className="space-y-3">
              <div className="rounded-xl border border-gray-100 bg-white p-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800"><Braces className="h-4 w-4 text-brand-green" /> Variables</p>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                  <input value={buscarVar} onChange={(e) => setBuscarVar(e.target.value)} placeholder="Buscar…" className={inputCls + ' pl-8'} />
                </div>
                <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                  {varsFiltradas.map((g) => (
                    <div key={g.grupo}>
                      <p className="text-[11px] font-bold uppercase text-gray-400">{g.grupo}</p>
                      <ul>
                        {g.variables.map((v) => (
                          <li key={v.ruta}>
                            <button type="button" disabled={!puedeEditar || vista !== 'editar'} onClick={() => insertar(`{{${v.ruta}}}`)} title={v.descripcion}
                              className="w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-gray-700 hover:bg-brand-green/10 disabled:hover:bg-transparent">
                              {v.ruta}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                  <div>
                    <p className="text-[11px] font-bold uppercase text-gray-400">Marcadores</p>
                    {MARCADORES_DOC.map((m) => (
                      <button key={m.marcador} type="button" disabled={!puedeEditar || vista !== 'editar'} onClick={() => insertar(m.marcador)} title={m.descripcion}
                        className="block w-full truncate rounded px-1 py-0.5 text-left font-mono text-[11px] text-violet-700 hover:bg-violet-50">{m.marcador}</button>
                    ))}
                  </div>
                  <div>
                    <p className="text-[11px] font-bold uppercase text-gray-400">Filtros · {'{{variable | filtro}}'}</p>
                    {FILTROS_DOC.map((f) => <p key={f.filtro} className="text-[11px] text-gray-600"><span className="font-mono">{f.filtro}</span> — {f.descripcion}</p>)}
                    <p className="mt-1 text-[11px] text-gray-500">Bloques: <span className="font-mono">{'{{#if x}}…{{else}}…{{/if}}'}</span> y <span className="font-mono">{'{{#each lista}}{{this.campo}}{{/each}}'}</span></p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-gray-100 bg-white p-3">
                <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-gray-800"><History className="h-4 w-4 text-brand-green" /> Versiones</p>
                <ul className="max-h-[36vh] space-y-1.5 overflow-y-auto pr-1">
                  {versionesDe(sel.id).map((v) => (
                    <li key={v.id} className={'rounded-lg border px-2.5 py-2 text-xs ' + (v.version === versionVista ? 'border-brand-green bg-brand-green/5' : 'border-gray-100')}>
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-gray-800">v{v.version}{v.version === sel.version_vigente && <Badge className="ml-1 bg-green-100 text-green-700">Vigente</Badge>}</span>
                        <button onClick={() => cargarVersion(v.version)} className="font-semibold text-brand-green">Ver</button>
                      </div>
                      <p className="text-gray-500">{fechaHora(v.created_at)} · {v.creado_por_nombre ?? '—'}</p>
                      {v.notas && <p className="text-gray-600">{v.notas}</p>}
                    </li>
                  ))}
                </ul>
                {puedeEditar && versionVista !== sel.version_vigente && (
                  <p className="mt-2 text-[11px] text-gray-500">Para volver a esta versión, publíquela: queda como una versión nueva y el historial se conserva.</p>
                )}
              </div>
            </aside>
          </div>
        </section>
      )}

      {nueva && (
        <Modal titulo={nueva.duplicar ? 'Duplicar plantilla' : 'Nueva plantilla'} onClose={() => setNueva(null)} ancho="max-w-lg"
          pie={<div className="flex justify-end gap-2"><Boton variante="secundario" onClick={() => setNueva(null)}>Cancelar</Boton><Boton onClick={crear} disabled={guardando === 'crear'}>{guardando === 'crear' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Crear</Boton></div>}>
          <div className="space-y-3">
            <Campo label="Código (único, en mayúsculas)" hint="Ej.: AUTORIZACION_DOTACION"><input value={nueva.codigo} onChange={(e) => setNueva({ ...nueva, codigo: e.target.value.toUpperCase() })} className={inputCls + ' font-mono'} /></Campo>
            <Campo label="Nombre"><input value={nueva.nombre} onChange={(e) => setNueva({ ...nueva, nombre: e.target.value })} className={inputCls} /></Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo label="Momento">
                <select value={nueva.momento} onChange={(e) => setNueva({ ...nueva, momento: e.target.value })} className={inputCls}>
                  {Object.entries(MOMENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Campo>
              <Campo label="Categoría">
                <select value={nueva.categoria} onChange={(e) => setNueva({ ...nueva, categoria: e.target.value })} className={inputCls}>
                  {CATEGORIAS.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Campo>
            </div>
            <p className="text-xs text-gray-500">{nueva.duplicar ? 'Se copia el texto que está en el editor como versión 1.' : 'Arranca con un esqueleto (encabezado, párrafo y firma) que puede editar.'}</p>
          </div>
        </Modal>
      )}
    </div>
  )
}

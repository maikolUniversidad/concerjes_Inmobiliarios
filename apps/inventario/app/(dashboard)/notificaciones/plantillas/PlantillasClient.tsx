'use client'

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useFormStatus } from 'react-dom'
import { toast } from 'sonner'
import {
  Plus, Save, Trash2, Eye, Send, Upload, Loader2, X, FileCode2, Power, AlertTriangle,
} from 'lucide-react'
import type { PlantillaCorreo, VariablePlantilla } from '@/lib/types/database'
import { payloadEjemplo, renderPlantilla, variablesUsadas } from '@/lib/email/plantillas'
import {
  guardarPlantilla, eliminarPlantilla, alternarPlantilla, enviarPruebaPlantilla, type ActionResult,
} from './actions'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'
const labelCls = 'font-body text-xs font-semibold text-gray-500'

/** Plantilla en blanco con la que arranca el editor al crear una nueva. */
const HTML_INICIAL = `<div style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;max-width:600px;margin:0 auto">
  <h2 style="color:#111827">{{titulo}}</h2>
  <p style="line-height:1.6">{{descripcion}}</p>
  <p><a href="{{enlace}}" style="background:#2E7D32;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Ver en la plataforma</a></p>
</div>`

function GuardarBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar plantilla
    </button>
  )
}

/** Texto del textarea de variables: `clave: descripción` por línea. */
function variablesATexto(variables: VariablePlantilla[]): string {
  return (variables ?? []).map((v) => (v.descripcion ? `${v.clave}: ${v.descripcion}` : v.clave)).join('\n')
}

export function PlantillasClient({ plantillas, avisoCorreo }: { plantillas: PlantillaCorreo[]; avisoCorreo: string }) {
  const [editando, setEditando] = useState<PlantillaCorreo | 'nueva' | null>(null)
  const [previsualizando, setPrevisualizando] = useState<PlantillaCorreo | null>(null)
  const [borrando, startBorrar] = useTransition()
  const [alternando, startAlternar] = useTransition()

  const porCategoria = useMemo(() => {
    const mapa = new Map<string, PlantillaCorreo[]>()
    for (const p of plantillas) {
      const cat = p.categoria || 'General'
      mapa.set(cat, [...(mapa.get(cat) ?? []), p])
    }
    return [...mapa.entries()]
  }, [plantillas])

  function borrar(p: PlantillaCorreo) {
    if (!confirm(`¿Eliminar la plantilla "${p.nombre}"? Esta acción no se puede deshacer.`)) return
    startBorrar(async () => {
      const r = await eliminarPlantilla(p.id)
      if (r.error) toast.error(r.error)
      else toast.success('Plantilla eliminada')
    })
  }

  function alternar(p: PlantillaCorreo) {
    startAlternar(async () => {
      const r = await alternarPlantilla(p.id, !p.activa)
      if (r.error) toast.error(r.error)
      else toast.success(p.activa ? 'Plantilla desactivada' : 'Plantilla activada')
    })
  }

  return (
    <div className="space-y-5">
      {avisoCorreo && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="font-body text-xs text-amber-800">
            {avisoCorreo} Las plantillas se pueden crear igual, pero no se enviarán hasta configurar el correo en{' '}
            <a href="/integraciones/correo" className="font-semibold underline">Integraciones · Correo</a>.
          </p>
        </div>
      )}

      <div className="flex justify-between items-center gap-3 flex-wrap">
        <p className="font-body text-sm text-gray-500">
          {plantillas.length} plantilla{plantillas.length !== 1 ? 's' : ''}
        </p>
        <button onClick={() => setEditando('nueva')}
          className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark">
          <Plus className="w-4 h-4" /> Nueva plantilla
        </button>
      </div>

      {plantillas.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-8 text-center shadow-sm">
          <FileCode2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="font-body text-sm text-gray-500">Aún no hay plantillas. Crea la primera o sube un HTML.</p>
        </div>
      ) : (
        porCategoria.map(([categoria, lista]) => (
          <div key={categoria} className="space-y-2">
            <h2 className="font-heading font-semibold text-sm text-gray-500 uppercase tracking-wide">{categoria}</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              {lista.map((p) => (
                <div key={p.id} className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-heading font-semibold text-sm text-gray-900 truncate">{p.nombre}</p>
                      <p className="font-body text-xs text-gray-400 truncate">{p.asunto}</p>
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {p.es_sistema && (
                        <span className="font-body text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">Sistema</span>
                      )}
                      <span className={`font-body text-[10px] px-1.5 py-0.5 rounded-full ${p.activa ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {p.activa ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>
                  </div>
                  {p.descripcion && <p className="font-body text-xs text-gray-500 line-clamp-2">{p.descripcion}</p>}
                  <p className="font-body text-[11px] text-gray-400">
                    <code className="bg-gray-50 px-1 rounded">{p.codigo}</code>
                    {(p.variables ?? []).length > 0 && ` · ${p.variables.length} variable(s)`}
                    {p.origen === 'ARCHIVO' && p.archivo_nombre && ` · ${p.archivo_nombre}`}
                  </p>
                  <div className="flex items-center gap-1 pt-1 border-t border-gray-50 mt-auto">
                    <button onClick={() => setEditando(p)} className="font-body text-xs text-brand-green font-semibold px-2 py-1 rounded hover:bg-green-50">Editar</button>
                    <button onClick={() => setPrevisualizando(p)} className="flex items-center gap-1 font-body text-xs text-gray-500 px-2 py-1 rounded hover:bg-gray-50">
                      <Eye className="w-3.5 h-3.5" /> Ver
                    </button>
                    <button onClick={() => alternar(p)} disabled={alternando}
                      className="flex items-center gap-1 font-body text-xs text-gray-500 px-2 py-1 rounded hover:bg-gray-50 disabled:opacity-50">
                      <Power className="w-3.5 h-3.5" /> {p.activa ? 'Desactivar' : 'Activar'}
                    </button>
                    {!p.es_sistema && (
                      <button onClick={() => borrar(p)} disabled={borrando}
                        className="flex items-center gap-1 font-body text-xs text-red-500 px-2 py-1 rounded hover:bg-red-50 ml-auto disabled:opacity-50">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}

      {editando && (
        <EditorPlantilla
          plantilla={editando === 'nueva' ? null : editando}
          onCerrar={() => setEditando(null)}
        />
      )}

      {previsualizando && (
        <Previsualizacion plantilla={previsualizando} onCerrar={() => setPrevisualizando(null)} />
      )}
    </div>
  )
}

// ── Editor ───────────────────────────────────────────────────────────────────
function EditorPlantilla({ plantilla, onCerrar }: { plantilla: PlantillaCorreo | null; onCerrar: () => void }) {
  const [state, action] = useActionState<ActionResult, FormData>(guardarPlantilla, {})
  const [html, setHtml] = useState(plantilla?.cuerpo_html ?? HTML_INICIAL)
  const [asunto, setAsunto] = useState(plantilla?.asunto ?? '')
  const [origen, setOrigen] = useState<'EDITOR' | 'ARCHIVO'>(plantilla?.origen ?? 'EDITOR')
  const [archivoNombre, setArchivoNombre] = useState(plantilla?.archivo_nombre ?? '')
  const [verPrevia, setVerPrevia] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (state.ok) { toast.success('Plantilla guardada'); onCerrar() }
    else if (state.error) toast.error(state.error)
  }, [state, onCerrar])

  const detectadas = useMemo(() => variablesUsadas(asunto, html), [asunto, html])

  async function subirArchivo(file: File) {
    if (!/\.html?$/i.test(file.name)) { toast.error('Sube un archivo .html'); return }
    if (file.size > 512 * 1024) { toast.error('El archivo supera los 512 KB.'); return }
    const texto = await file.text()
    setHtml(texto)
    setOrigen('ARCHIVO')
    setArchivoNombre(file.name)
    toast.success(`Cargado ${file.name}. Revisa el contenido y guarda.`)
  }

  const previa = useMemo(() => renderPlantilla(
    { asunto, cuerpo_html: html, cuerpo_texto: null },
    payloadEjemplo(detectadas.map((clave) => ({ clave }))),
  ), [asunto, html, detectadas])

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl z-10">
          <h2 className="font-heading font-bold text-lg text-gray-900">
            {plantilla ? 'Editar plantilla' : 'Nueva plantilla'}
          </h2>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>

        <form action={action} className="p-5 space-y-4">
          {plantilla && <input type="hidden" name="id" value={plantilla.id} />}
          <input type="hidden" name="cuerpo_html" value={html} />
          <input type="hidden" name="origen" value={origen} />
          <input type="hidden" name="archivo_nombre" value={archivoNombre} />

          <div className="grid sm:grid-cols-2 gap-4">
            <label><span className={labelCls}>Nombre *</span>
              <input name="nombre" required defaultValue={plantilla?.nombre ?? ''} placeholder="Aviso de orden aprobada" className={inputCls + ' mt-1'} /></label>
            <label><span className={labelCls}>Código {plantilla && <span className="text-gray-400">(no se puede cambiar sin romper los flujos)</span>}</span>
              <input name="codigo" defaultValue={plantilla?.codigo ?? ''} placeholder="Se genera del nombre" className={inputCls + ' mt-1'} /></label>
            <label><span className={labelCls}>Categoría</span>
              <input name="categoria" defaultValue={plantilla?.categoria ?? 'General'} className={inputCls + ' mt-1'} /></label>
            <label className="flex items-end pb-2 gap-2 font-body text-xs text-gray-600">
              <input type="checkbox" name="activa" defaultChecked={plantilla?.activa ?? true} className="accent-brand-green w-4 h-4" /> Plantilla activa
            </label>
          </div>

          <label className="block"><span className={labelCls}>Descripción</span>
            <input name="descripcion" defaultValue={plantilla?.descripcion ?? ''} placeholder="Para qué sirve esta plantilla" className={inputCls + ' mt-1'} /></label>

          <label className="block"><span className={labelCls}>Asunto *</span>
            <input name="asunto" required value={asunto} onChange={(e) => setAsunto(e.target.value)}
              placeholder="Orden {{numero}} aprobada" className={inputCls + ' mt-1'} /></label>

          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
              <span className={labelCls}>Cuerpo del correo (HTML) *</span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setVerPrevia((v) => !v)}
                  className="flex items-center gap-1 font-body text-xs text-gray-600 border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50">
                  <Eye className="w-3.5 h-3.5" /> {verPrevia ? 'Ver código' : 'Previsualizar'}
                </button>
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-1 font-body text-xs text-gray-600 border border-gray-200 rounded-lg px-2 py-1 hover:bg-gray-50">
                  <Upload className="w-3.5 h-3.5" /> Subir HTML
                </button>
                <input ref={fileRef} type="file" accept=".html,.htm,text/html" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void subirArchivo(f); e.target.value = '' }} />
              </div>
            </div>

            {verPrevia ? (
              <iframe title="Previsualización" srcDoc={previa.html} sandbox=""
                className="w-full h-72 border border-gray-200 rounded-lg bg-white" />
            ) : (
              <textarea value={html} onChange={(e) => { setHtml(e.target.value); setOrigen('EDITOR') }}
                rows={12} spellCheck={false}
                className={inputCls + ' font-mono text-xs leading-relaxed'} />
            )}
            <p className="font-body text-[11px] text-gray-400 mt-1">
              Usa <code className="bg-gray-50 px-1 rounded">{'{{variable}}'}</code> donde quieras insertar datos del evento.
              Los scripts y iframes se eliminan al guardar.
            </p>
          </div>

          <label className="block"><span className={labelCls}>Texto plano (opcional)</span>
            <textarea name="cuerpo_texto" rows={3} defaultValue={plantilla?.cuerpo_texto ?? ''}
              placeholder="Si lo dejas vacío se genera a partir del HTML." className={inputCls + ' mt-1'} /></label>

          <label className="block"><span className={labelCls}>Variables (una por línea, «clave: descripción»)</span>
            <textarea name="variables" rows={3} defaultValue={variablesATexto(plantilla?.variables ?? [])}
              placeholder={'titulo: Título del aviso\nenlace: Ruta al registro'} className={inputCls + ' mt-1 font-mono text-xs'} /></label>

          {detectadas.length > 0 && (
            <p className="font-body text-xs text-gray-500">
              Detectadas en el contenido: {detectadas.map((v) => (
                <code key={v} className="bg-gray-50 px-1 rounded mr-1">{`{{${v}}}`}</code>
              ))}
            </p>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
            <GuardarBtn />
            <button type="button" onClick={onCerrar} className="font-body text-sm text-gray-500 hover:text-gray-700">Cancelar</button>
          </div>
        </form>

        {plantilla && (
          <div className="px-5 pb-5">
            <PruebaForm id={plantilla.id} />
          </div>
        )}
      </div>
    </div>
  )
}

function EnviarPruebaBtn() {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-1.5 border border-brand-green/40 text-brand-green font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-green-50 disabled:opacity-50">
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enviar
    </button>
  )
}

function PruebaForm({ id }: { id: string }) {
  const [state, action] = useActionState<ActionResult, FormData>(enviarPruebaPlantilla, {})
  useEffect(() => {
    if (state.ok) toast.success('Correo de prueba enviado')
    else if (state.error) toast.error(state.error)
  }, [state])

  return (
    <form action={action} className="bg-gray-50 rounded-xl p-3 flex items-center gap-2 flex-wrap">
      <input type="hidden" name="id" value={id} />
      <span className="font-body text-xs text-gray-500">Enviar prueba a:</span>
      <input name="para" type="email" placeholder="destinatario@correo.com (o la propia cuenta)"
        className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
      <EnviarPruebaBtn />
    </form>
  )
}

// ── Previsualización ─────────────────────────────────────────────────────────
function Previsualizacion({ plantilla, onCerrar }: { plantilla: PlantillaCorreo; onCerrar: () => void }) {
  const render = renderPlantilla(plantilla, payloadEjemplo(plantilla.variables ?? []))
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-3 sm:p-6 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h2 className="font-heading font-bold text-base text-gray-900 truncate">{plantilla.nombre}</h2>
            <p className="font-body text-xs text-gray-400 truncate">Asunto: {render.asunto}</p>
          </div>
          <button onClick={onCerrar} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5">
          <iframe title="Vista del correo" srcDoc={render.html} sandbox=""
            className="w-full h-[420px] border border-gray-200 rounded-lg bg-white" />
          <p className="font-body text-[11px] text-gray-400 mt-2">
            Las variables se muestran con sus valores de ejemplo.
          </p>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useEffect, useState, useTransition } from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Tag, Plus, X, Pencil, Trash2, Loader2, ChevronDown, ChevronRight, Check, Settings2, Building2, FolderPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  ETIQUETA_COLORES, ETIQUETA_COLOR_NOMBRES, colorEtiqueta, TIPO_CONTRATO_META, TIPO_CONTRATO_OPCIONES,
  type Categoria, type Etiqueta, type TipoContrato,
} from '@/lib/clasificacion'
import { grupoColor } from '@/lib/types/database'
import { DeleteButton } from '@/components/ui/DeleteButton'
import {
  guardarCategoria, eliminarCategoria, guardarEtiqueta, eliminarEtiqueta,
  setTipoGrupo, asignarEtiquetasGrupo,
} from './etiquetas-actions'
import { crearGrupo, actualizarGrupo, eliminarGrupo, type ActionResult } from './actions'

// ── Badges reutilizables ──────────────────────────────────────────────────────
export function TipoBadge({ tipo, heredado }: { tipo: TipoContrato | null; heredado?: boolean }) {
  if (!tipo) return <span className="font-body text-xs text-gray-400">Sin clasificar</span>
  const m = TIPO_CONTRATO_META[tipo]
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 font-body text-[11px] font-semibold ${m.badge}`}>{m.label}{heredado ? ' (grupo)' : ''}</span>
}

export function EtiquetaChip({ et, onRemove }: { et: Etiqueta; onRemove?: () => void }) {
  const c = colorEtiqueta(et.color)
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-medium ${c.badge}`}>
      {et.nombre}
      {onRemove && <button type="button" onClick={onRemove} className="hover:opacity-70"><X className="w-3 h-3" /></button>}
    </span>
  )
}

// ── Selector de etiquetas (agrupado por categoría) ───────────────────────────────
export function EtiquetaPicker({
  categorias, etiquetas, value, onChange, name,
}: {
  categorias: Categoria[]; etiquetas: Etiqueta[]; value: string[]
  onChange: (ids: string[]) => void; name?: string
}) {
  const porCat = (catId: string) => etiquetas.filter(e => e.categoria_id === catId)

  function toggle(cat: Categoria, id: string) {
    const enCat = porCat(cat.id).map(e => e.id)
    let next: string[]
    if (value.includes(id)) next = value.filter(x => x !== id)
    else if (cat.multiple) next = [...value, id]
    else next = [...value.filter(x => !enCat.includes(x)), id]  // categoría de valor único
    onChange(next)
  }

  const conValores = categorias.filter(c => porCat(c.id).length > 0)
  if (conValores.length === 0) {
    return <p className="font-body text-xs text-gray-400">No hay categorías de etiquetas. Créalas en «Etiquetas de clasificación».</p>
  }

  return (
    <div className="space-y-2.5">
      {conValores.map(cat => (
        <div key={cat.id}>
          <p className="mb-1 font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400">{cat.nombre}{!cat.multiple && ' (uno)'}</p>
          <div className="flex flex-wrap gap-1.5">
            {porCat(cat.id).map(e => {
              const sel = value.includes(e.id)
              const c = colorEtiqueta(e.color ?? cat.color)
              return (
                <button key={e.id} type="button" onClick={() => toggle(cat, e.id)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-body text-xs transition-all ${
                    sel ? `${c.badge} border-transparent font-semibold` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}>
                  {sel && <Check className="w-3 h-3" />}{e.nombre}
                </button>
              )
            })}
          </div>
        </div>
      ))}
      {name && value.map(id => <input key={id} type="hidden" name={name} value={id} />)}
    </div>
  )
}

// ── Clasificación por grupo de contrato ──────────────────────────────────────────
export interface GrupoClasif { id: string; codigo: string; nombre: string; descripcion: string | null; tipo_contrato: TipoContrato | null; etiquetaIds: string[] }

function GrupoSubmit({ editando }: { editando: boolean }) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" disabled={pending}
      className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
      {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
      {editando ? 'Guardar cambios' : 'Crear contrato'}
    </button>
  )
}

const grupoInputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

/** Formulario para dar de alta o editar un contrato (grupo). */
function ContratoForm({ editing, onDone }: { editing: GrupoClasif | null; onDone: () => void }) {
  const action = editing ? actualizarGrupo : crearGrupo
  const [state, formAction] = useActionState<ActionResult, FormData>(action, {})
  const [tipo, setTipo] = useState<TipoContrato | ''>(editing?.tipo_contrato ?? '')

  useEffect(() => { if (state.ok) onDone() }, [state.ok, onDone])

  return (
    <form action={formAction} key={editing?.id ?? 'nuevo'} className="rounded-2xl border border-brand-green/30 bg-green-50/40 p-4 space-y-3">
      {editing && <input type="hidden" name="id" value={editing.id} />}
      <p className="font-heading font-semibold text-sm text-gray-800">{editing ? 'Editar contrato' : 'Nuevo contrato'}</p>
      {state.error && <p className="font-body text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{state.error}</p>}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-2">
          <label className="font-body font-semibold text-xs text-gray-600">Nombre del contrato *</label>
          <input name="nombre" required defaultValue={editing?.nombre ?? ''} className={grupoInputCls + ' mt-1'} placeholder="Ej: Ministerio de Salud" />
        </div>
        <div>
          <label className="font-body font-semibold text-xs text-gray-600">Código</label>
          <input name="codigo" defaultValue={editing?.codigo ?? ''} maxLength={20} className={grupoInputCls + ' mt-1 uppercase'} placeholder="Auto" />
          <p className="font-body text-[11px] text-gray-400 mt-0.5">Si lo dejas vacío se genera solo.</p>
        </div>
      </div>
      <div>
        <label className="font-body font-semibold text-xs text-gray-600">Descripción</label>
        <input name="descripcion" defaultValue={editing?.descripcion ?? ''} className={grupoInputCls + ' mt-1'} placeholder="Sedes / entidades que agrupa (opcional)" />
      </div>
      <div>
        <label className="font-body font-semibold text-xs text-gray-600 block mb-1">Tipo de contrato</label>
        <input type="hidden" name="tipo_contrato" value={tipo} />
        <div className="flex gap-1.5">
          {TIPO_CONTRATO_OPCIONES.map(o => (
            <button key={o.value} type="button" onClick={() => setTipo(t => t === o.value ? '' : o.value)}
              className={`rounded-lg border px-3 py-1.5 font-body text-xs font-semibold transition-all ${
                tipo === o.value ? `${TIPO_CONTRATO_META[o.value].badge} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'
              }`}>{o.label}</button>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <GrupoSubmit editando={!!editing} />
        <button type="button" onClick={onDone} className="font-body text-sm text-gray-500 px-2 py-2">Cancelar</button>
      </div>
    </form>
  )
}

export function GruposClasificacion({ grupos, categorias, etiquetas }: { grupos: GrupoClasif[]; categorias: Categoria[]; etiquetas: Etiqueta[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [abierto, setAbierto] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const [editing, setEditing] = useState<GrupoClasif | null>(null)

  function guardarTipo(id: string, tipo: TipoContrato | null) {
    start(async () => {
      const r = await setTipoGrupo(id, tipo)
      if (r.error) toast.error(r.error); else { toast.success('Tipo de contrato actualizado.'); router.refresh() }
    })
  }
  function guardarTags(id: string, ids: string[]) {
    start(async () => {
      const r = await asignarEtiquetasGrupo(id, ids)
      if (r.error) toast.error(r.error); else router.refresh()
    })
  }
  function cerrarForm() { setCreando(false); setEditing(null); router.refresh() }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-sm text-gray-900">Contratos ({grupos.length})</h2>
        </div>
        {!creando && !editing && (
          <button onClick={() => setCreando(true)}
            className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-brand-green-dark">
            <FolderPlus className="w-3.5 h-3.5" /> Nuevo contrato
          </button>
        )}
      </div>

      {(creando || editing) && <ContratoForm editing={editing} onDone={cerrarForm} />}

      {grupos.length === 0 && !creando ? (
        <div className="rounded-2xl border border-dashed border-gray-200 p-8 text-center">
          <Building2 className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          <p className="font-body text-sm text-gray-500">No hay contratos todavía. Crea el primero para poder registrar sus sedes.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {grupos.map(g => {
            const open = abierto === g.id
            const tags = etiquetas.filter(e => g.etiquetaIds.includes(e.id))
            return (
              <div key={g.id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm group/card">
                <div className="flex items-center justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-bold ${grupoColor(g.codigo)}`}>{g.codigo}</span>
                    <span className="font-heading font-bold text-sm text-gray-900 truncate">{g.nombre}</span>
                  </div>
                  <TipoBadge tipo={g.tipo_contrato} />
                </div>
                {g.descripcion && <p className="font-body text-sm text-gray-600 leading-relaxed line-clamp-2">{g.descripcion}</p>}
                {tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{tags.map(t => <EtiquetaChip key={t.id} et={t} />)}</div>}

                <div className="mt-3 flex items-center gap-3">
                  <button onClick={() => setAbierto(open ? null : g.id)}
                    className="inline-flex items-center gap-1 font-body text-xs font-semibold text-brand-green hover:underline">
                    <Settings2 className="w-3.5 h-3.5" /> {open ? 'Cerrar' : 'Clasificar'}
                    {pending && open && <Loader2 className="w-3 h-3 animate-spin" />}
                  </button>
                  <button onClick={() => { setCreando(false); setEditing(g) }}
                    className="inline-flex items-center gap-1 font-body text-xs font-semibold text-gray-500 hover:text-blue-600">
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </button>
                  <DeleteButton action={eliminarGrupo} id={g.id}
                    mensaje={`¿Eliminar el contrato “${g.nombre}”? Si tiene sedes, se archivará en vez de borrarse.`}
                    className="inline-flex items-center gap-1 font-body text-xs font-semibold text-gray-500 hover:text-red-600">
                    <Trash2 className="w-3.5 h-3.5" /> Eliminar
                  </DeleteButton>
                </div>

                {open && (
                  <div className="mt-3 space-y-3 border-t border-gray-100 pt-3">
                    <div>
                      <p className="mb-1 font-body text-[11px] font-semibold uppercase tracking-wide text-gray-400">Tipo de contrato</p>
                      <div className="flex gap-1.5">
                        {TIPO_CONTRATO_OPCIONES.map(o => (
                          <button key={o.value} onClick={() => guardarTipo(g.id, g.tipo_contrato === o.value ? null : o.value)}
                            className={`rounded-lg border px-3 py-1.5 font-body text-xs font-semibold transition-all ${
                              g.tipo_contrato === o.value ? `${TIPO_CONTRATO_META[o.value].badge} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                            }`}>{o.label}</button>
                        ))}
                      </div>
                    </div>
                    <EtiquetaPicker categorias={categorias} etiquetas={etiquetas} value={g.etiquetaIds} onChange={ids => guardarTags(g.id, ids)} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Gestor de categorías + etiquetas ─────────────────────────────────────────────
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

export function EtiquetasManager({ categorias, etiquetas }: { categorias: Categoria[]; etiquetas: Etiqueta[] }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [abierto, setAbierto] = useState(false)
  const [editCat, setEditCat] = useState<Categoria | null>(null)
  const [nuevaCat, setNuevaCat] = useState(false)

  function accion(fn: () => Promise<{ error?: string }>, ok?: string) {
    start(async () => {
      const r = await fn()
      if (r.error) toast.error(r.error); else { if (ok) toast.success(ok); router.refresh() }
    })
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
      <button onClick={() => setAbierto(v => !v)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4 text-brand-green" />
          <h2 className="font-heading font-semibold text-sm text-gray-900">Etiquetas de clasificación</h2>
          <span className="font-body text-xs text-gray-400">{categorias.length} categorías · {etiquetas.length} etiquetas</span>
        </div>
        {abierto ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {abierto && (
        <div className="border-t border-gray-100 p-4 space-y-3">
          {categorias.map(cat => {
            const vals = etiquetas.filter(e => e.categoria_id === cat.id)
            const c = colorEtiqueta(cat.color)
            return (
              <div key={cat.id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`h-2.5 w-2.5 rounded-full ${c.dot}`} />
                    <span className="font-body font-semibold text-sm text-gray-800 truncate">{cat.nombre}</span>
                    <span className="font-body text-[11px] text-gray-400">{cat.multiple ? 'varias' : 'una'}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={() => setEditCat(cat)} title="Editar categoría" className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => { if (confirm(`¿Eliminar la categoría "${cat.nombre}" y sus etiquetas?`)) accion(() => eliminarCategoria(cat.id), 'Categoría eliminada.') }}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                {cat.descripcion && <p className="mt-0.5 font-body text-xs text-gray-400">{cat.descripcion}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {vals.map(e => (
                    <span key={e.id} className={`group inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-[11px] font-medium ${colorEtiqueta(e.color ?? cat.color).badge}`}>
                      {e.nombre}
                      <button onClick={() => accion(() => eliminarEtiqueta(e.id))} className="opacity-50 hover:opacity-100"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  <NuevaEtiqueta categoriaId={cat.id} onSave={(nombre, color) => accion(() => guardarEtiqueta({ categoria_id: cat.id, nombre, color }), 'Etiqueta agregada.')} />
                </div>
              </div>
            )
          })}

          {nuevaCat || editCat ? (
            <CategoriaForm
              cat={editCat}
              onCancel={() => { setNuevaCat(false); setEditCat(null) }}
              onSave={(input) => { accion(() => guardarCategoria(input), editCat ? 'Categoría actualizada.' : 'Categoría creada.'); setNuevaCat(false); setEditCat(null) }}
            />
          ) : (
            <button onClick={() => setNuevaCat(true)}
              className="flex items-center gap-1.5 border border-brand-green text-brand-green font-body font-semibold text-xs px-3 py-2 rounded-lg hover:bg-green-50">
              <Plus className="w-3.5 h-3.5" /> Nueva categoría
            </button>
          )}
          {pending && <p className="font-body text-xs text-gray-400 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Guardando…</p>}
        </div>
      )}
    </div>
  )
}

function NuevaEtiqueta({ categoriaId, onSave }: { categoriaId: string; onSave: (nombre: string, color: string) => void }) {
  const [abrir, setAbrir] = useState(false)
  const [nombre, setNombre] = useState('')
  const [color, setColor] = useState('gray')
  if (!abrir) return <button onClick={() => setAbrir(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2 py-0.5 font-body text-[11px] text-gray-500 hover:border-brand-green hover:text-brand-green"><Plus className="w-3 h-3" /> valor</button>
  return (
    <span className="inline-flex items-center gap-1">
      <input autoFocus value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Valor…"
        onKeyDown={e => { if (e.key === 'Enter' && nombre.trim()) { onSave(nombre.trim(), color); setNombre(''); setAbrir(false) } if (e.key === 'Escape') setAbrir(false) }}
        className="w-24 rounded border border-gray-200 px-1.5 py-0.5 text-xs outline-none focus:border-brand-green" />
      <ColorSelect value={color} onChange={setColor} />
      <button onClick={() => { if (nombre.trim()) { onSave(nombre.trim(), color); setNombre(''); setAbrir(false) } }} className="text-brand-green"><Check className="w-3.5 h-3.5" /></button>
      <button onClick={() => setAbrir(false)} className="text-gray-400"><X className="w-3.5 h-3.5" /></button>
    </span>
  )
}

function ColorSelect({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <span className="inline-flex gap-0.5">
      {ETIQUETA_COLOR_NOMBRES.map(c => (
        <button key={c} type="button" onClick={() => onChange(c)} title={c}
          className={`h-4 w-4 rounded-full ${ETIQUETA_COLORES[c].dot} ${value === c ? 'ring-2 ring-offset-1 ring-gray-400' : ''}`} />
      ))}
    </span>
  )
}

function CategoriaForm({ cat, onSave, onCancel }: { cat: Categoria | null; onSave: (i: { id?: string; nombre: string; descripcion: string | null; color: string; multiple: boolean }) => void; onCancel: () => void }) {
  const [nombre, setNombre] = useState(cat?.nombre ?? '')
  const [descripcion, setDescripcion] = useState(cat?.descripcion ?? '')
  const [color, setColor] = useState(cat?.color ?? 'gray')
  const [multiple, setMultiple] = useState(cat?.multiple ?? true)
  return (
    <div className="rounded-xl border border-brand-green/30 bg-green-50/40 p-3 space-y-2">
      <p className="font-body font-semibold text-xs text-gray-700">{cat ? 'Editar categoría' : 'Nueva categoría'}</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre (ej: Modalidad)" className={inputCls} />
        <input value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Descripción (opcional)" className={inputCls} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1"><span className="font-body text-xs text-gray-500">Color:</span><ColorSelect value={color} onChange={setColor} /></span>
        <label className="flex items-center gap-1.5 font-body text-xs text-gray-600">
          <input type="checkbox" checked={multiple} onChange={e => setMultiple(e.target.checked)} className="w-4 h-4 accent-brand-green" /> Permitir varias etiquetas por contrato
        </label>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => nombre.trim() && onSave({ id: cat?.id, nombre: nombre.trim(), descripcion: descripcion.trim() || null, color, multiple })}
          className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-brand-green-dark">
          <Check className="w-3.5 h-3.5" /> Guardar
        </button>
        <button onClick={onCancel} className="font-body text-xs text-gray-500 px-2 py-1.5">Cancelar</button>
      </div>
    </div>
  )
}

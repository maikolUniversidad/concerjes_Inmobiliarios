'use client'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  MapPin, Plus, Move, X, Loader2, Search, Trash2, Package, User, Save,
  ArrowLeftRight, ImageIcon, Pencil, Check,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { ImagePicker } from '@/components/ui/ImagePicker'
import Link from 'next/link'
import {
  crearUbicacion, actualizarUbicacion, moverUbicacion, eliminarUbicacion, asignarProductoUbicacion,
} from '../actions'
import { PlanoViewer } from './PlanoViewer'
import type { PlanoPiso } from './plano/plano-tipos'

export interface Ubic {
  id: string; codigo: string; nombre: string | null; tipo: string | null
  descripcion: string | null; foto_url: string | null
  pos_x: number | null; pos_y: number | null
  responsable_id: string | null; responsable_nombre: string | null
}
export interface ProdMin { id: string; nombre_estandar: string; sku: string | null; ref: number | null; ubicacion_id: string | null }
interface Mov { tipo: string; cantidad: number; created_at: string; producto: { nombre_estandar: string } | null }

const TIPOS = ['ESTANTERIA', 'ZONA', 'NEVERA', 'PALLET', 'VITRINA', 'OTRO']
const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 font-body text-sm outline-none focus:border-brand-green'

export function BodegaPlano({ bodegaId, planoUrl, pisos = [], ubicacionesIniciales, productos: prodsIniciales, usuarios }: {
  bodegaId: string; planoUrl: string | null; pisos?: PlanoPiso[]
  ubicacionesIniciales: Ubic[]; productos: ProdMin[]; usuarios: { id: string; nombre: string }[]
}) {
  const tieneDiseno = pisos.some(p => (p.elementos?.length ?? 0) > 0)
  const [ubics, setUbics] = useState<Ubic[]>(ubicacionesIniciales)
  const [prods, setProds] = useState<ProdMin[]>(prodsIniciales)
  const [selId, setSelId] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [addForm, setAddForm] = useState<{ pos_x: number | null; pos_y: number | null } | null>(null)
  const [movs, setMovs] = useState<Record<string, Mov[]>>({})
  const planoRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null)

  const sel = ubics.find(u => u.id === selId) ?? null
  const colocados = ubics.filter(u => u.pos_x !== null && u.pos_y !== null)

  const prodsDeUbic = useCallback((uid: string) => prods.filter(p => p.ubicacion_id === uid), [prods])

  // ── Cargar movimientos de una ubicación (lazy) ──
  const cargarMovs = useCallback(async (uid: string) => {
    if (movs[uid]) return
    const supabase = createClient()
    const { data } = await supabase
      .from('movimientos')
      .select('tipo, cantidad, created_at, producto:productos ( nombre_estandar )')
      .eq('ubicacion_id', uid).order('created_at', { ascending: false }).limit(10)
    setMovs(m => ({ ...m, [uid]: (data as unknown as Mov[]) ?? [] }))
  }, [movs])

  function seleccionar(id: string) { setSelId(id); setAddForm(null); cargarMovs(id) }

  // ── Coordenadas relativas al plano ──
  function posDesdeEvento(clientX: number, clientY: number) {
    const r = planoRef.current!.getBoundingClientRect()
    const x = Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100))
    const y = Math.min(100, Math.max(0, ((clientY - r.top) / r.height) * 100))
    return { x, y }
  }

  function onPlanoClick(e: React.MouseEvent) {
    if (!editMode || !planoUrl) return
    if (dragRef.current) return
    const { x, y } = posDesdeEvento(e.clientX, e.clientY)
    setAddForm({ pos_x: Math.round(x * 100) / 100, pos_y: Math.round(y * 100) / 100 })
    setSelId(null)
  }

  // ── Arrastrar marcador ──
  function onMarkerPointerDown(e: React.PointerEvent, u: Ubic) {
    if (!editMode) return
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    dragRef.current = { id: u.id, moved: false }
  }
  function onMarkerPointerMove(e: React.PointerEvent, u: Ubic) {
    if (!dragRef.current || dragRef.current.id !== u.id) return
    dragRef.current.moved = true
    const { x, y } = posDesdeEvento(e.clientX, e.clientY)
    setUbics(prev => prev.map(p => p.id === u.id ? { ...p, pos_x: x, pos_y: y } : p))
  }
  async function onMarkerPointerUp(e: React.PointerEvent, u: Ubic) {
    if (!dragRef.current || dragRef.current.id !== u.id) return
    const moved = dragRef.current.moved
    dragRef.current = null
    if (moved) {
      const cur = ubics.find(p => p.id === u.id)!
      await moverUbicacion(u.id, bodegaId, cur.pos_x ?? 0, cur.pos_y ?? 0)
    } else {
      seleccionar(u.id)
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr,380px] gap-5">
      {/* ── PLANO ── */}
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-brand-green" />
            <h2 className="font-heading font-semibold text-sm text-gray-900">Plano · {colocados.length}/{ubics.length} ubicaciones marcadas</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/bodegas/${bodegaId}/plano`}
              className="flex items-center gap-1.5 font-body font-semibold text-xs px-3 py-1.5 rounded-lg border border-brand-green/40 text-brand-green hover:bg-green-50 transition-colors">
              <Pencil className="w-3.5 h-3.5" /> {tieneDiseno ? 'Editar en el diseñador' : 'Diseñar plano'}
            </Link>
            {planoUrl && !tieneDiseno && (
              <button onClick={() => { setEditMode(v => !v); setAddForm(null) }}
                className={`flex items-center gap-1.5 font-body font-semibold text-xs px-3 py-1.5 rounded-lg transition-colors ${editMode ? 'bg-brand-green text-white' : 'border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                <Move className="w-3.5 h-3.5" /> {editMode ? 'Editando — toca el plano para agregar' : 'Editar marcadores'}
              </button>
            )}
          </div>
        </div>

        {tieneDiseno ? (
          <PlanoViewer pisos={pisos} />
        ) : planoUrl ? (
          <div
            ref={planoRef}
            onClick={onPlanoClick}
            className={`relative select-none ${editMode ? 'cursor-crosshair' : ''}`}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={planoUrl} alt="Plano de la bodega" className="w-full block" draggable={false} />
            {colocados.map(u => {
              const n = prodsDeUbic(u.id).length
              const active = selId === u.id
              return (
                <button
                  key={u.id}
                  onPointerDown={e => onMarkerPointerDown(e, u)}
                  onPointerMove={e => onMarkerPointerMove(e, u)}
                  onPointerUp={e => onMarkerPointerUp(e, u)}
                  onClick={e => { e.stopPropagation(); if (!editMode) seleccionar(u.id) }}
                  style={{ left: `${u.pos_x}%`, top: `${u.pos_y}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center group ${editMode ? 'cursor-move' : 'cursor-pointer'}`}
                >
                  <span className={`flex items-center justify-center w-7 h-7 rounded-full text-white text-[11px] font-bold shadow-lg ring-2 ring-white transition-transform group-hover:scale-110 ${active ? 'bg-brand-green-dark scale-110' : n > 0 ? 'bg-brand-green' : 'bg-amber-500'}`}>
                    {n || <MapPin className="w-3.5 h-3.5" />}
                  </span>
                  <span className="mt-0.5 bg-white/90 font-mono text-[10px] px-1 rounded shadow-sm whitespace-nowrap">{u.codigo}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <div className="p-10 text-center text-gray-400">
            <ImageIcon className="w-10 h-10 mx-auto mb-2 text-gray-300" />
            <p className="font-body text-sm">Esta bodega no tiene plano todavía.</p>
            <p className="font-body text-xs mt-1">Sube uno en <span className="font-semibold">Editar bodega</span> para ubicar visualmente las estanterías. Igual puedes administrar las ubicaciones en el panel de la derecha.</p>
          </div>
        )}
      </div>

      {/* ── PANEL ── */}
      <div className="space-y-4">
        {addForm ? (
          <UbicForm bodegaId={bodegaId} usuarios={usuarios} pos={addForm}
            onCancel={() => setAddForm(null)}
            onSaved={(nueva) => { setUbics(p => [...p, nueva]); setAddForm(null); setSelId(nueva.id) }} />
        ) : sel ? (
          <UbicDetalle
            key={sel.id} ubic={sel} bodegaId={bodegaId} usuarios={usuarios}
            productos={prods} movimientos={movs[sel.id] ?? []}
            onClose={() => setSelId(null)}
            onUpdated={(u) => setUbics(prev => prev.map(x => x.id === u.id ? u : x))}
            onDeleted={(id) => { setUbics(prev => prev.filter(x => x.id !== id)); setProds(prev => prev.map(p => p.ubicacion_id === id ? { ...p, ubicacion_id: null } : p)); setSelId(null) }}
            onAsignar={(prodId, ubicId) => setProds(prev => prev.map(p => p.id === prodId ? { ...p, ubicacion_id: ubicId } : p))}
          />
        ) : (
          <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-heading font-semibold text-sm text-gray-900">Ubicaciones ({ubics.length})</h2>
              <button onClick={() => setAddForm({ pos_x: null, pos_y: null })}
                className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-xs px-3 py-1.5 rounded-lg hover:bg-brand-green-dark">
                <Plus className="w-3.5 h-3.5" /> Agregar
              </button>
            </div>
            {ubics.length === 0 ? (
              <p className="px-4 py-8 text-center font-body text-sm text-gray-400">Sin ubicaciones. Agrega la primera o toca el plano en modo edición.</p>
            ) : (
              <div className="divide-y divide-gray-50 max-h-[560px] overflow-y-auto">
                {ubics.map(u => {
                  const n = prodsDeUbic(u.id).length
                  return (
                    <button key={u.id} onClick={() => seleccionar(u.id)} className="w-full text-left px-4 py-3 hover:bg-gray-50/50 flex items-center gap-3">
                      <span className="w-8 h-8 rounded-lg overflow-hidden bg-gray-100 shrink-0 flex items-center justify-center relative">
                        {u.foto_url ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={u.foto_url} alt="" className="object-cover w-full h-full" /> : <Package className="w-4 h-4 text-gray-400" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-body font-medium text-sm text-gray-900 truncate"><span className="font-mono text-xs text-gray-500">{u.codigo}</span> {u.nombre}</p>
                        <p className="font-body text-xs text-gray-400">{u.tipo} · {n} producto{n === 1 ? '' : 's'}{u.pos_x === null ? ' · sin marcar' : ''}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Formulario nueva ubicación ──────────────────────────────────────────────
function UbicForm({ bodegaId, usuarios, pos, onCancel, onSaved }: {
  bodegaId: string; usuarios: { id: string; nombre: string }[]
  pos: { pos_x: number | null; pos_y: number | null }
  onCancel: () => void; onSaved: (u: Ubic) => void
}) {
  const [codigo, setCodigo] = useState('')
  const [nombre, setNombre] = useState('')
  const [tipo, setTipo] = useState('ESTANTERIA')
  const [responsable, setResponsable] = useState('')
  const [foto, setFoto] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function guardar() {
    if (!codigo.trim()) { setError('El código es obligatorio.'); return }
    setSaving(true); setError('')
    const res = await crearUbicacion({ bodega_id: bodegaId, codigo, nombre, tipo, responsable_id: responsable || null, foto_url: foto, pos_x: pos.pos_x ?? undefined, pos_y: pos.pos_y ?? undefined })
    setSaving(false)
    if (res.error || !res.id) { setError(res.error ?? 'Error'); return }
    onSaved({ id: res.id, codigo: codigo.trim(), nombre: nombre.trim() || null, tipo, descripcion: null, foto_url: foto, pos_x: pos.pos_x, pos_y: pos.pos_y, responsable_id: responsable || null, responsable_nombre: usuarios.find(u => u.id === responsable)?.nombre ?? null })
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-heading font-semibold text-gray-900">Nueva ubicación</h3>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
      </div>
      {pos.pos_x !== null && <p className="font-body text-xs text-brand-green">📍 Posicionada en el plano ({pos.pos_x?.toFixed(0)}%, {pos.pos_y?.toFixed(0)}%)</p>}
      {error && <p className="font-body text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
      <div className="grid grid-cols-2 gap-3">
        <div><label className="font-body font-semibold text-xs text-gray-600">Código *</label><input value={codigo} onChange={e => setCodigo(e.target.value)} className={inputCls + ' mt-1'} placeholder="A-01-03" /></div>
        <div><label className="font-body font-semibold text-xs text-gray-600">Tipo</label>
          <select value={tipo} onChange={e => setTipo(e.target.value)} className={inputCls + ' mt-1 bg-white'}>{TIPOS.map(t => <option key={t}>{t}</option>)}</select>
        </div>
      </div>
      <div><label className="font-body font-semibold text-xs text-gray-600">Nombre / referencia</label><input value={nombre} onChange={e => setNombre(e.target.value)} className={inputCls + ' mt-1'} placeholder="Estantería A · Nivel 1" /></div>
      <div><label className="font-body font-semibold text-xs text-gray-600">Responsable</label>
        <select value={responsable} onChange={e => setResponsable(e.target.value)} className={inputCls + ' mt-1 bg-white'}>
          <option value="">— Ninguno —</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
        </select>
      </div>
      <ImagePicker name="foto_ubic" bucket="galeria-fotos" folder="bodegas/ubicaciones" label="Foto de la estantería / lugar" onChange={setFoto} />
      <button onClick={guardar} disabled={saving} className="w-full flex items-center justify-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2.5 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Crear ubicación
      </button>
    </div>
  )
}

// ─── Detalle / edición de ubicación ──────────────────────────────────────────
function UbicDetalle({ ubic, bodegaId, usuarios, productos, movimientos, onClose, onUpdated, onDeleted, onAsignar }: {
  ubic: Ubic; bodegaId: string; usuarios: { id: string; nombre: string }[]; productos: ProdMin[]; movimientos: Mov[]
  onClose: () => void; onUpdated: (u: Ubic) => void; onDeleted: (id: string) => void
  onAsignar: (prodId: string, ubicId: string | null) => void
}) {
  const [edit, setEdit] = useState(false)
  const [codigo, setCodigo] = useState(ubic.codigo)
  const [nombre, setNombre] = useState(ubic.nombre ?? '')
  const [tipo, setTipo] = useState(ubic.tipo ?? 'ESTANTERIA')
  const [responsable, setResponsable] = useState(ubic.responsable_id ?? '')
  const [foto, setFoto] = useState<string | null>(ubic.foto_url)
  const [busca, setBusca] = useState('')
  const [saving, setSaving] = useState(false)

  const asignados = useMemo(() => productos.filter(p => p.ubicacion_id === ubic.id), [productos, ubic.id])
  const candidatos = useMemo(() => {
    const q = busca.trim().toLowerCase()
    if (!q) return []
    return productos.filter(p => p.ubicacion_id !== ubic.id &&
      (p.nombre_estandar.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q) || String(p.ref ?? '').includes(q))).slice(0, 8)
  }, [productos, busca, ubic.id])

  async function guardar() {
    setSaving(true)
    const res = await actualizarUbicacion({ id: ubic.id, bodega_id: bodegaId, codigo, nombre, tipo, responsable_id: responsable || null, foto_url: foto })
    setSaving(false)
    if (!res.error) {
      onUpdated({ ...ubic, codigo: codigo.trim(), nombre: nombre.trim() || null, tipo, responsable_id: responsable || null, responsable_nombre: usuarios.find(u => u.id === responsable)?.nombre ?? null, foto_url: foto })
      setEdit(false)
    }
  }
  async function asignar(prodId: string) { onAsignar(prodId, ubic.id); setBusca(''); await asignarProductoUbicacion(prodId, ubic.id, bodegaId) }
  async function quitar(prodId: string) { onAsignar(prodId, null); await asignarProductoUbicacion(prodId, null, bodegaId) }
  async function borrar() {
    if (!window.confirm(`¿Eliminar la ubicación ${ubic.codigo}? Los productos quedarán sin ubicación.`)) return
    onDeleted(ubic.id); await eliminarUbicacion(ubic.id, bodegaId)
  }

  return (
    <div className="bg-white border border-gray-100 rounded-2xl shadow-sm">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded shrink-0">{ubic.codigo}</span>
          <h3 className="font-heading font-semibold text-sm text-gray-900 truncate">{ubic.nombre ?? ubic.tipo}</h3>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setEdit(v => !v)} className="p-1.5 rounded-lg text-gray-400 hover:text-brand-green hover:bg-green-50" title="Editar"><Pencil className="w-4 h-4" /></button>
          <button onClick={borrar} className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50" title="Eliminar"><Trash2 className="w-4 h-4" /></button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="p-4 space-y-4 max-h-[620px] overflow-y-auto">
        {edit ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="font-body font-semibold text-xs text-gray-600">Código</label><input value={codigo} onChange={e => setCodigo(e.target.value)} className={inputCls + ' mt-1'} /></div>
              <div><label className="font-body font-semibold text-xs text-gray-600">Tipo</label><select value={tipo} onChange={e => setTipo(e.target.value)} className={inputCls + ' mt-1 bg-white'}>{TIPOS.map(t => <option key={t}>{t}</option>)}</select></div>
            </div>
            <div><label className="font-body font-semibold text-xs text-gray-600">Nombre</label><input value={nombre} onChange={e => setNombre(e.target.value)} className={inputCls + ' mt-1'} /></div>
            <div><label className="font-body font-semibold text-xs text-gray-600">Responsable</label>
              <select value={responsable} onChange={e => setResponsable(e.target.value)} className={inputCls + ' mt-1 bg-white'}>
                <option value="">— Ninguno —</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}
              </select>
            </div>
            <ImagePicker name="foto_ubic_e" defaultUrl={ubic.foto_url} bucket="galeria-fotos" folder="bodegas/ubicaciones" label="Foto de la estantería / lugar" onChange={setFoto} />
            <div className="flex gap-2">
              <button onClick={guardar} disabled={saving} className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
              </button>
              <button onClick={() => setEdit(false)} className="font-body text-sm text-gray-500 px-3">Cancelar</button>
            </div>
          </div>
        ) : (
          <>
            {ubic.foto_url
              ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={ubic.foto_url} alt={ubic.codigo} className="w-full aspect-video object-cover rounded-xl border border-gray-100" />
              : <div className="w-full aspect-video rounded-xl bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center text-gray-300"><ImageIcon className="w-8 h-8" /></div>}
            <div className="flex items-center justify-between text-sm">
              <span className="font-body text-gray-500">{ubic.tipo}</span>
              {ubic.responsable_nombre && <span className="flex items-center gap-1 font-body text-gray-600"><User className="w-3.5 h-3.5" /> {ubic.responsable_nombre}</span>}
            </div>
          </>
        )}

        {/* Productos asignados */}
        <div>
          <p className="font-heading font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><Package className="w-4 h-4 text-brand-green" /> Mercancía aquí ({asignados.length})</p>
          <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 mb-2">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar producto para asignar..." className="font-body text-sm flex-1 outline-none" />
          </div>
          {candidatos.length > 0 && (
            <div className="border border-gray-100 rounded-lg divide-y divide-gray-50 mb-2">
              {candidatos.map(p => (
                <button key={p.id} onClick={() => asignar(p.id)} className="w-full text-left px-3 py-2 hover:bg-green-50/50 flex items-center justify-between gap-2">
                  <span className="font-body text-sm text-gray-700 truncate">{p.nombre_estandar}{p.sku ? ` · ${p.sku}` : ''}</span>
                  <Plus className="w-4 h-4 text-brand-green shrink-0" />
                </button>
              ))}
            </div>
          )}
          {asignados.length === 0 ? (
            <p className="font-body text-xs text-gray-400">Sin productos asignados.</p>
          ) : (
            <div className="space-y-1">
              {asignados.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded-lg px-3 py-1.5">
                  <span className="font-body text-sm text-gray-700 truncate">{p.nombre_estandar}</span>
                  <button onClick={() => quitar(p.id)} className="text-gray-400 hover:text-red-600 shrink-0" title="Quitar de aquí"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Movimientos en esta ubicación */}
        <div>
          <p className="font-heading font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><ArrowLeftRight className="w-4 h-4 text-brand-green" /> Movimientos recientes</p>
          {movimientos.length === 0 ? (
            <p className="font-body text-xs text-gray-400">Sin movimientos registrados en esta ubicación.</p>
          ) : (
            <div className="space-y-1">
              {movimientos.map((m, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-xs font-body py-1 border-b border-gray-50 last:border-0">
                  <span className={`font-semibold ${m.tipo === 'ENTRADA' ? 'text-green-600' : m.tipo === 'SALIDA' ? 'text-red-600' : 'text-blue-600'}`}>{m.tipo}</span>
                  <span className="text-gray-600 truncate flex-1 px-2">{m.producto?.nombre_estandar}</span>
                  <span className="text-gray-900 font-bold">{m.cantidad}</span>
                  <span className="text-gray-300">{new Date(m.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' })}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

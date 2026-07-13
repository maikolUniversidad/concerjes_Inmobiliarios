'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Save, Plus, Trash2, ZoomIn, ZoomOut, Grid3x3, Magnet, Layers,
  RotateCw, Copy, MapPin, Loader2, Maximize2,
} from 'lucide-react'
import { guardarPiso, eliminarPiso } from '../../actions'
import { ELEMENTOS, CATEGORIAS, type ElementoTipo, type PlanoElemento, type PlanoPiso } from './plano-tipos'

interface Props {
  bodegaId: string
  pisosIniciales: PlanoPiso[]
  ubicaciones: { id: string; codigo: string; nombre: string | null }[]
}

type DragState =
  | { mode: 'move'; id: string; sx: number; sy: number; ox: number; oy: number }
  | { mode: 'resize'; id: string; sx: number; sy: number; ow: number; oh: number }
  | null

const SNAP = 0.25 // metros
function snap(v: number, on: boolean) { return on ? Math.round(v / SNAP) * SNAP : Math.round(v * 100) / 100 }
function uid() { return 'el_' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36) }

export function PlanoDesigner({ bodegaId, pisosIniciales, ubicaciones }: Props) {
  const [pisos, setPisos] = useState<PlanoPiso[]>(pisosIniciales)
  const [activeId, setActiveId] = useState<string | null>(pisosIniciales[0]?.id ?? null)
  const [selId, setSelId] = useState<string | null>(null)
  const [escala, setEscala] = useState<number>(pisosIniciales[0]?.escala ?? 40)
  const [grid, setGrid] = useState(true)
  const [snapOn, setSnapOn] = useState(true)
  const [saving, setSaving] = useState(false)
  const [creando, setCreando] = useState(false)

  const svgWrapRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState>(null)

  const piso = pisos.find(p => p.id === activeId) ?? null
  const elementos = piso?.elementos ?? []
  const sel = elementos.find(e => e.id === selId) ?? null

  // ── Helpers de mutación del piso activo ──
  const patchPiso = useCallback((patch: Partial<PlanoPiso>) => {
    setPisos(prev => prev.map(p => (p.id === activeId ? { ...p, ...patch } : p)))
  }, [activeId])

  const setElementos = useCallback((fn: (els: PlanoElemento[]) => PlanoElemento[]) => {
    setPisos(prev => prev.map(p => (p.id === activeId ? { ...p, elementos: fn(p.elementos) } : p)))
  }, [activeId])

  const patchEl = useCallback((id: string, patch: Partial<PlanoElemento>) => {
    setElementos(els => els.map(e => (e.id === id ? { ...e, ...patch } : e)))
  }, [setElementos])

  // ── Agregar elemento ──
  function addElemento(tipo: ElementoTipo) {
    if (!piso) return
    const cfg = ELEMENTOS[tipo]
    const x = snap(Math.max(0, piso.ancho_m / 2 - cfg.w / 2), snapOn)
    const y = snap(Math.max(0, piso.alto_m / 2 - cfg.h / 2), snapOn)
    const el: PlanoElemento = { id: uid(), tipo, x, y, w: cfg.w, h: cfg.h, rot: 0, etiqueta: '' }
    setElementos(els => [...els, el])
    setSelId(el.id)
  }

  function duplicar(e: PlanoElemento) {
    const copia: PlanoElemento = { ...e, id: uid(), x: snap(e.x + 0.5, snapOn), y: snap(e.y + 0.5, snapOn) }
    setElementos(els => [...els, copia])
    setSelId(copia.id)
  }

  function borrar(id: string) {
    setElementos(els => els.filter(e => e.id !== id))
    if (selId === id) setSelId(null)
  }

  // ── Drag (mover / redimensionar) con listeners globales ──
  useEffect(() => {
    function onMove(ev: PointerEvent) {
      const d = dragRef.current
      if (!d || !piso) return
      const dxm = (ev.clientX - d.sx) / escala
      const dym = (ev.clientY - d.sy) / escala
      if (d.mode === 'move') {
        const nx = Math.max(0, Math.min(piso.ancho_m - 0.1, snap(d.ox + dxm, snapOn)))
        const ny = Math.max(0, Math.min(piso.alto_m - 0.1, snap(d.oy + dym, snapOn)))
        patchEl(d.id, { x: nx, y: ny })
      } else {
        const nw = Math.max(0.1, snap(d.ow + dxm, snapOn))
        const nh = Math.max(0.1, snap(d.oh + dym, snapOn))
        patchEl(d.id, { w: nw, h: nh })
      }
    }
    function onUp() { dragRef.current = null }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp) }
  }, [escala, snapOn, piso, patchEl])

  function startMove(e: PlanoElemento, ev: React.PointerEvent) {
    ev.stopPropagation()
    setSelId(e.id)
    dragRef.current = { mode: 'move', id: e.id, sx: ev.clientX, sy: ev.clientY, ox: e.x, oy: e.y }
  }
  function startResize(e: PlanoElemento, ev: React.PointerEvent) {
    ev.stopPropagation()
    setSelId(e.id)
    dragRef.current = { mode: 'resize', id: e.id, sx: ev.clientX, sy: ev.clientY, ow: e.w, oh: e.h }
  }

  // ── Guardar piso ──
  async function guardar() {
    if (!piso) return
    setSaving(true)
    const res = await guardarPiso({
      id: piso.id, bodega_id: bodegaId, numero: piso.numero, nombre: piso.nombre,
      ancho_m: piso.ancho_m, alto_m: piso.alto_m, escala, fondo_url: piso.fondo_url, elementos: piso.elementos,
    })
    setSaving(false)
    if (res.error) { toast.error(res.error); return }
    // Sincroniza el id real (el upsert pudo insertar una fila nueva)
    if (res.id && res.id !== piso.id) {
      const realId = res.id
      setPisos(prev => prev.map(p => (p.id === piso.id ? { ...p, id: realId } : p)))
      setActiveId(realId)
    }
    toast.success(`Plano del piso "${piso.nombre ?? piso.numero}" guardado en la bodega`)
  }

  // ── Pisos ──
  async function agregarPiso() {
    setCreando(true)
    const numero = (pisos.reduce((m, p) => Math.max(m, p.numero), 0) || 0) + 1
    const res = await guardarPiso({
      bodega_id: bodegaId, numero, nombre: `Piso ${numero}`,
      ancho_m: 20, alto_m: 15, escala: 40, elementos: [],
    })
    setCreando(false)
    if (res.error || !res.id) { toast.error(res.error ?? 'No se pudo crear el piso'); return }
    const nuevo: PlanoPiso = {
      id: res.id, bodega_id: bodegaId, numero, nombre: `Piso ${numero}`,
      ancho_m: 20, alto_m: 15, escala: 40, fondo_url: null, elementos: [], orden: numero,
    }
    setPisos(prev => [...prev, nuevo])
    setActiveId(res.id); setEscala(40); setSelId(null)
    toast.success('Piso creado')
  }

  async function borrarPiso() {
    if (!piso) return
    if (pisos.length <= 1) { toast.error('Debe existir al menos un piso.'); return }
    if (!confirm(`¿Eliminar el piso "${piso.nombre ?? piso.numero}" y su plano?`)) return
    const res = await eliminarPiso(piso.id, bodegaId)
    if (res.error) { toast.error(res.error); return }
    const rest = pisos.filter(p => p.id !== piso.id)
    setPisos(rest); setActiveId(rest[0]?.id ?? null); setSelId(null)
    toast.success('Piso eliminado')
  }

  // ── Sin pisos: crear el primero ──
  if (!piso) {
    return (
      <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center shadow-sm">
        <Layers className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="font-body text-sm text-gray-500 mb-4">Esta bodega aún no tiene un plano.</p>
        <button onClick={agregarPiso} disabled={creando}
          className="inline-flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-xl hover:bg-brand-green-dark disabled:opacity-60">
          {creando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Crear primer piso
        </button>
      </div>
    )
  }

  const W = piso.ancho_m * escala
  const H = piso.alto_m * escala

  return (
    <div className="space-y-3">
      {/* ── Barra de pisos + acciones ── */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto">
          {pisos.map(p => (
            <button key={p.id} onClick={() => { setActiveId(p.id); setEscala(p.escala); setSelId(null) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-body text-xs font-semibold whitespace-nowrap transition-colors ${
                p.id === activeId ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Layers className="w-3.5 h-3.5" /> {p.nombre ?? `Piso ${p.numero}`}
            </button>
          ))}
          <button onClick={agregarPiso} disabled={creando} title="Agregar piso"
            className="px-2 py-1.5 rounded-lg text-gray-500 hover:text-brand-green">
            {creando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          </button>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setGrid(g => !g)} title="Cuadrícula"
            className={`p-2 rounded-lg border transition-colors ${grid ? 'border-brand-green text-brand-green bg-green-50' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            <Grid3x3 className="w-4 h-4" />
          </button>
          <button onClick={() => setSnapOn(s => !s)} title="Ajustar a cuadrícula (0.25 m)"
            className={`p-2 rounded-lg border transition-colors ${snapOn ? 'border-brand-green text-brand-green bg-green-50' : 'border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
            <Magnet className="w-4 h-4" />
          </button>
          <button onClick={() => setEscala(s => Math.max(12, Math.round(s / 1.25)))} title="Alejar"
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><ZoomOut className="w-4 h-4" /></button>
          <button onClick={() => setEscala(s => Math.min(140, Math.round(s * 1.25)))} title="Acercar"
            className="p-2 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><ZoomIn className="w-4 h-4" /></button>
          <button onClick={borrarPiso} title="Eliminar piso"
            className="p-2 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
          <button onClick={guardar} disabled={saving}
            className="flex items-center gap-1.5 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-brand-green-dark disabled:opacity-60">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
          </button>
        </div>
      </div>

      {/* ── Dimensiones del piso ── */}
      <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm flex flex-wrap items-end gap-3">
        <Campo label="Nombre del piso">
          <input value={piso.nombre ?? ''} onChange={e => patchPiso({ nombre: e.target.value })}
            className="w-40 border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
        </Campo>
        <Campo label="Ancho (m)">
          <input type="number" min={1} step={0.5} value={piso.ancho_m}
            onChange={e => patchPiso({ ancho_m: Math.max(1, Number(e.target.value) || 1) })}
            className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
        </Campo>
        <Campo label="Alto (m)">
          <input type="number" min={1} step={0.5} value={piso.alto_m}
            onChange={e => patchPiso({ alto_m: Math.max(1, Number(e.target.value) || 1) })}
            className="w-24 border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
        </Campo>
        <span className="font-body text-xs text-gray-400 flex items-center gap-1">
          <Maximize2 className="w-3.5 h-3.5" /> {piso.ancho_m} × {piso.alto_m} m · {(piso.ancho_m * piso.alto_m).toFixed(1)} m² · {elementos.length} elementos
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-3">
        {/* ── Paleta ── */}
        <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm space-y-3 h-fit">
          <p className="font-body font-semibold text-xs text-gray-500 uppercase tracking-wide">Elementos</p>
          {CATEGORIAS.map(cat => {
            const tipos = (Object.keys(ELEMENTOS) as ElementoTipo[]).filter(t => ELEMENTOS[t].categoria === cat)
            if (tipos.length === 0) return null
            return (
              <div key={cat}>
                <p className="font-body text-[11px] text-gray-400 mb-1">{cat}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {tipos.map(t => (
                    <button key={t} onClick={() => addElemento(t)}
                      className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-gray-200 hover:border-brand-green hover:bg-green-50 transition-colors text-left">
                      <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: ELEMENTOS[t].color, border: `1px solid ${ELEMENTOS[t].borde}` }} />
                      <span className="font-body text-[11px] text-gray-700 truncate">{ELEMENTOS[t].label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Lienzo ── */}
        <div className="bg-white border border-gray-100 rounded-2xl p-3 shadow-sm overflow-auto max-h-[70vh]" ref={svgWrapRef}>
          <svg
            width={W + 28} height={H + 28}
            onPointerDown={() => setSelId(null)}
            style={{ touchAction: 'none', minWidth: W + 28 }}
          >
            {/* Regla superior e izquierda */}
            <g transform="translate(28,28)">
              {/* Fondo */}
              <rect x={0} y={0} width={W} height={H} fill="#fafafa" stroke="#e5e7eb" />

              {/* Cuadrícula (cada 1 m; marcada cada 5 m) */}
              {grid && Array.from({ length: Math.floor(piso.ancho_m) + 1 }, (_, i) => (
                <line key={`vx${i}`} x1={i * escala} y1={0} x2={i * escala} y2={H}
                  stroke={i % 5 === 0 ? '#d1d5db' : '#eef2f7'} strokeWidth={1} />
              ))}
              {grid && Array.from({ length: Math.floor(piso.alto_m) + 1 }, (_, i) => (
                <line key={`hy${i}`} x1={0} y1={i * escala} x2={W} y2={i * escala}
                  stroke={i % 5 === 0 ? '#d1d5db' : '#eef2f7'} strokeWidth={1} />
              ))}

              {/* Elementos */}
              {elementos.map(e => (
                <Elemento key={e.id} e={e} escala={escala} selected={e.id === selId}
                  onPointerDown={ev => startMove(e, ev)}
                  onResize={ev => startResize(e, ev)} />
              ))}
            </g>

            {/* Números de regla (metros) */}
            <g>
              {Array.from({ length: Math.floor(piso.ancho_m) + 1 }, (_, i) => i % 2 === 0 && (
                <text key={`rx${i}`} x={28 + i * escala} y={18} fontSize={9} fill="#9ca3af" textAnchor="middle">{i}</text>
              ))}
              {Array.from({ length: Math.floor(piso.alto_m) + 1 }, (_, i) => i % 2 === 0 && (
                <text key={`ry${i}`} x={14} y={28 + i * escala + 3} fontSize={9} fill="#9ca3af" textAnchor="middle">{i}</text>
              ))}
            </g>
          </svg>
        </div>
      </div>

      {/* ── Propiedades del elemento seleccionado ── */}
      {sel && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-4 h-4 rounded-sm" style={{ background: sel.color ?? ELEMENTOS[sel.tipo].color, border: `1px solid ${ELEMENTOS[sel.tipo].borde}` }} />
              <h3 className="font-heading font-semibold text-sm text-gray-900">{ELEMENTOS[sel.tipo].label}</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <button onClick={() => duplicar(sel)} title="Duplicar" className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><Copy className="w-3.5 h-3.5" /></button>
              <button onClick={() => patchEl(sel.id, { rot: (sel.rot + 90) % 360 })} title="Rotar 90°" className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><RotateCw className="w-3.5 h-3.5" /></button>
              <button onClick={() => borrar(sel.id)} title="Eliminar" className="p-1.5 rounded-lg border border-red-200 text-red-500 hover:bg-red-50"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Campo label="Etiqueta">
              <input value={sel.etiqueta ?? ''} onChange={e => patchEl(sel.id, { etiqueta: e.target.value })}
                placeholder={ELEMENTOS[sel.tipo].label}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
            </Campo>
            <Campo label="Ancho (m)">
              <input type="number" min={0.1} step={0.1} value={sel.w}
                onChange={e => patchEl(sel.id, { w: Math.max(0.1, Number(e.target.value) || 0.1) })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
            </Campo>
            <Campo label="Alto (m)">
              <input type="number" min={0.1} step={0.1} value={sel.h}
                onChange={e => patchEl(sel.id, { h: Math.max(0.1, Number(e.target.value) || 0.1) })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
            </Campo>
            <Campo label="Rotación (°)">
              <input type="number" step={15} value={sel.rot}
                onChange={e => patchEl(sel.id, { rot: ((Number(e.target.value) || 0) % 360 + 360) % 360 })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
            </Campo>
            <Campo label="X (m)">
              <input type="number" step={0.25} value={sel.x}
                onChange={e => patchEl(sel.id, { x: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
            </Campo>
            <Campo label="Y (m)">
              <input type="number" step={0.25} value={sel.y}
                onChange={e => patchEl(sel.id, { y: Math.max(0, Number(e.target.value) || 0) })}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green" />
            </Campo>
            <Campo label="Color">
              <input type="color"
                value={sel.color ?? (ELEMENTOS[sel.tipo].color === 'transparent' ? '#ffffff' : ELEMENTOS[sel.tipo].color)}
                onChange={e => patchEl(sel.id, { color: e.target.value })}
                className="w-full h-9 border border-gray-200 rounded-lg px-1 py-1 cursor-pointer" />
            </Campo>
            {/* Enlace a ubicación (para estantes/zonas) */}
            {(sel.tipo === 'ESTANTE' || sel.tipo === 'ALMACEN' || sel.tipo === 'NEVERA' || sel.tipo === 'PALLET' || sel.tipo === 'VITRINA') && (
              <Campo label="Ubicación real">
                <select value={sel.ubicacion_id ?? ''} onChange={e => patchEl(sel.id, { ubicacion_id: e.target.value || null })}
                  className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 font-body text-sm outline-none focus:border-brand-green bg-white">
                  <option value="">— Sin enlazar —</option>
                  {ubicaciones.map(u => <option key={u.id} value={u.id}>{u.codigo}{u.nombre ? ` · ${u.nombre}` : ''}</option>)}
                </select>
              </Campo>
            )}
          </div>
          {sel.ubicacion_id && (
            <p className="font-body text-xs text-brand-green mt-2 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5" /> Enlazado a la ubicación {ubicaciones.find(u => u.id === sel.ubicacion_id)?.codigo ?? ''}
            </p>
          )}
        </div>
      )}

      <p className="font-body text-xs text-gray-400">
        Consejo: haz clic en un elemento de la paleta para agregarlo, arrástralo para moverlo y usa el
        cuadrito de la esquina para cambiar su tamaño. Las medidas están en metros a escala real.
      </p>
    </div>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="font-body text-[11px] text-gray-400">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  )
}

// ── Render de un elemento en el SVG ──
function Elemento({ e, escala, selected, onPointerDown, onResize }: {
  e: PlanoElemento; escala: number; selected: boolean
  onPointerDown: (ev: React.PointerEvent) => void
  onResize: (ev: React.PointerEvent) => void
}) {
  const cfg = ELEMENTOS[e.tipo]
  const x = e.x * escala, y = e.y * escala
  const w = e.w * escala, h = e.h * escala
  const fill = e.color ?? cfg.color
  const cx = w / 2, cy = h / 2
  const mostrarTexto = w > 34 && h > 18

  return (
    <g transform={`translate(${x},${y}) rotate(${e.rot} ${cx} ${cy})`} style={{ cursor: 'move' }}>
      {/* Cuerpo */}
      {cfg.render === 'etiqueta' ? (
        <rect width={w} height={h} rx={3} fill="transparent" stroke={selected ? '#2E7D32' : cfg.borde} strokeDasharray="4 3"
          onPointerDown={onPointerDown} />
      ) : (
        <rect width={w} height={h} rx={cfg.render === 'columna' ? Math.min(w, h) / 2 : 3}
          fill={fill} fillOpacity={e.tipo === 'PASILLO' || e.tipo === 'ALMACEN' || e.tipo === 'ZONA_CARGA' ? 0.5 : 0.9}
          stroke={selected ? '#2E7D32' : cfg.borde} strokeWidth={selected ? 2 : 1.25}
          onPointerDown={onPointerDown} />
      )}

      {/* Decoraciones por tipo */}
      {cfg.render === 'puerta' && (
        <path d={`M0,${h} A${Math.max(w, 16)},${Math.max(w, 16)} 0 0 1 ${Math.max(w, 16)},0`}
          fill="none" stroke={cfg.borde} strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />
      )}
      {cfg.render === 'escalera' && Array.from({ length: Math.max(2, Math.floor(h / 10)) }, (_, i) => (
        <line key={i} x1={0} y1={(i + 1) * (h / Math.max(2, Math.floor(h / 10)))} x2={w} y2={(i + 1) * (h / Math.max(2, Math.floor(h / 10)))}
          stroke={cfg.borde} strokeWidth={0.75} pointerEvents="none" />
      ))}
      {cfg.render === 'rampa' && (
        <path d={`M2,${h - 2} L${w - 2},2`} stroke={cfg.borde} strokeWidth={1} markerEnd="" pointerEvents="none" />
      )}
      {cfg.render === 'ventana' && (
        <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={cfg.borde} strokeWidth={1} pointerEvents="none" />
      )}

      {/* Texto */}
      {mostrarTexto && (
        <text x={cx} y={cy - 1} fontSize={10} fill="#1f2937" textAnchor="middle" pointerEvents="none" style={{ fontWeight: 600 }}>
          {e.etiqueta || cfg.label}
        </text>
      )}
      {mostrarTexto && (
        <text x={cx} y={cy + 11} fontSize={8} fill="#6b7280" textAnchor="middle" pointerEvents="none">
          {e.w}×{e.h} m
        </text>
      )}

      {/* Handle de tamaño (solo seleccionado) */}
      {selected && (
        <rect x={w - 6} y={h - 6} width={12} height={12} rx={2} fill="#2E7D32" stroke="#fff" strokeWidth={1.5}
          style={{ cursor: 'nwse-resize', touchAction: 'none' }} onPointerDown={onResize} />
      )}
    </g>
  )
}

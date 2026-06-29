'use client'
import { useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize2, Database } from 'lucide-react'

// ─── Modelo de datos (nodos = tablas, edges = claves foráneas) ───────────────
interface NodoDef { id: string; label: string; dominio: keyof typeof DOMINIOS }
const DOMINIOS = {
  inventario: { nombre: 'Inventario', color: '#16a34a' },
  bodegas:    { nombre: 'Bodegas',    color: '#0d9488' },
  compras:    { nombre: 'Compras',    color: '#f59e0b' },
  operacion:  { nombre: 'Operación',  color: '#2563eb' },
  arqueo:     { nombre: 'Arqueo',     color: '#7c3aed' },
  usuarios:   { nombre: 'Usuarios',   color: '#dc2626' },
  auditoria:  { nombre: 'Auditoría',  color: '#64748b' },
} as const

const NODOS: NodoDef[] = [
  { id: 'productos', label: 'productos', dominio: 'inventario' },
  { id: 'stock', label: 'stock', dominio: 'inventario' },
  { id: 'movimientos', label: 'movimientos', dominio: 'inventario' },
  { id: 'producto_fotos', label: 'producto_fotos', dominio: 'inventario' },
  { id: 'bodegas', label: 'bodegas', dominio: 'bodegas' },
  { id: 'ubicaciones', label: 'ubicaciones', dominio: 'bodegas' },
  { id: 'proveedores', label: 'proveedores', dominio: 'compras' },
  { id: 'precios_proveedor', label: 'precios_proveedor', dominio: 'compras' },
  { id: 'ordenes_compra', label: 'ordenes_compra', dominio: 'compras' },
  { id: 'oc_items', label: 'oc_items', dominio: 'compras' },
  { id: 'aprovisionamiento', label: 'aprovisionamiento', dominio: 'compras' },
  { id: 'grupos_contrato', label: 'grupos_contrato', dominio: 'operacion' },
  { id: 'sedes', label: 'sedes', dominio: 'operacion' },
  { id: 'pedidos_sede', label: 'pedidos_sede', dominio: 'operacion' },
  { id: 'rotacion', label: 'rotacion', dominio: 'operacion' },
  { id: 'arqueos', label: 'arqueos', dominio: 'arqueo' },
  { id: 'arqueo_items', label: 'arqueo_items', dominio: 'arqueo' },
  { id: 'usuarios', label: 'usuarios', dominio: 'usuarios' },
  { id: 'roles', label: 'roles', dominio: 'usuarios' },
  { id: 'actividad_log', label: 'actividad_log', dominio: 'auditoria' },
  { id: 'historial_cambios', label: 'historial_cambios', dominio: 'auditoria' },
  { id: 'importaciones', label: 'importaciones', dominio: 'auditoria' },
]

const EDGES: [string, string, string][] = [
  ['stock', 'productos', 'producto_id'],
  ['movimientos', 'productos', 'producto_id'],
  ['movimientos', 'sedes', 'sede_id'],
  ['movimientos', 'ordenes_compra', 'oc_id'],
  ['movimientos', 'ubicaciones', 'ubicacion_id'],
  ['movimientos', 'usuarios', 'usuario_id'],
  ['producto_fotos', 'productos', 'producto_id'],
  ['productos', 'proveedores', 'proveedor_id'],
  ['productos', 'ubicaciones', 'ubicacion_id'],
  ['precios_proveedor', 'productos', 'producto_id'],
  ['precios_proveedor', 'proveedores', 'proveedor_id'],
  ['ordenes_compra', 'proveedores', 'proveedor_id'],
  ['oc_items', 'ordenes_compra', 'oc_id'],
  ['oc_items', 'productos', 'producto_id'],
  ['aprovisionamiento', 'productos', 'producto_id'],
  ['aprovisionamiento', 'proveedores', 'proveedor_sug_id'],
  ['sedes', 'grupos_contrato', 'grupo_id'],
  ['pedidos_sede', 'sedes', 'sede_id'],
  ['pedidos_sede', 'productos', 'producto_id'],
  ['rotacion', 'productos', 'producto_id'],
  ['rotacion', 'grupos_contrato', 'grupo_id'],
  ['usuarios', 'grupos_contrato', 'grupo_id'],
  ['usuarios', 'sedes', 'sede_id'],
  ['usuarios', 'roles', 'rol_id'],
  ['bodegas', 'usuarios', 'responsable_id'],
  ['ubicaciones', 'bodegas', 'bodega_id'],
  ['ubicaciones', 'usuarios', 'responsable_id'],
  ['arqueos', 'usuarios', 'creado_por'],
  ['arqueo_items', 'arqueos', 'arqueo_id'],
  ['arqueo_items', 'productos', 'producto_id'],
  ['actividad_log', 'usuarios', 'usuario_id'],
  ['historial_cambios', 'usuarios', 'usuario_id'],
  ['importaciones', 'usuarios', 'usuario_id'],
]

const W = 1100, H = 760, CX = W / 2, CY = H / 2, R = 320

function posicionesIniciales(): Record<string, { x: number; y: number }> {
  // Orden por dominio para agrupar visualmente
  const orden = [...NODOS].sort((a, b) => Object.keys(DOMINIOS).indexOf(a.dominio) - Object.keys(DOMINIOS).indexOf(b.dominio))
  const pos: Record<string, { x: number; y: number }> = {}
  orden.forEach((n, i) => {
    const ang = (i / orden.length) * Math.PI * 2 - Math.PI / 2
    pos[n.id] = { x: CX + R * Math.cos(ang), y: CY + R * Math.sin(ang) }
  })
  return pos
}

interface DragState { tipo: 'pan' | 'node'; id?: string; sx: number; sy: number; ox: number; oy: number }

export function GrafoRelaciones() {
  const [pos, setPos] = useState(posicionesIniciales)
  const [sel, setSel] = useState<string | null>(null)
  const [view, setView] = useState({ x: 0, y: 0, s: 1 })
  const drag = useRef<DragState | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const conectados = useMemo(() => {
    if (!sel) return new Set<string>()
    const s = new Set<string>()
    EDGES.forEach(([a, b]) => { if (a === sel) s.add(b); if (b === sel) s.add(a) })
    return s
  }, [sel])

  const relaciones = useMemo(() => {
    if (!sel) return [] as { otro: string; via: string; dir: 'out' | 'in' }[]
    const r: { otro: string; via: string; dir: 'out' | 'in' }[] = []
    EDGES.forEach(([a, b, via]) => {
      if (a === sel) r.push({ otro: b, via, dir: 'out' })
      if (b === sel) r.push({ otro: a, via, dir: 'in' })
    })
    return r
  }, [sel])

  function onPointerDownNode(e: React.PointerEvent, id: string) {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { tipo: 'node', id, sx: e.clientX, sy: e.clientY, ox: pos[id].x, oy: pos[id].y }
    setSel(id)
  }
  function onPointerDownBg(e: React.PointerEvent) {
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = { tipo: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy
    if (d.tipo === 'pan') setView(v => ({ ...v, x: d.ox + dx, y: d.oy + dy }))
    else if (d.id) setPos(p => ({ ...p, [d.id!]: { x: d.ox + dx / view.s, y: d.oy + dy / view.s } }))
  }
  function onPointerUp() { drag.current = null }

  function zoom(f: number) { setView(v => ({ ...v, s: Math.min(2.5, Math.max(0.4, v.s * f)) })) }
  function reset() { setPos(posicionesIniciales()); setView({ x: 0, y: 0, s: 1 }); setSel(null) }

  return (
    <div className="grid lg:grid-cols-[1fr,300px] gap-4">
      <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden relative">
        {/* Controles */}
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1.5">
          <button onClick={() => zoom(1.2)} className="w-8 h-8 bg-white border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-50 shadow-sm"><ZoomIn className="w-4 h-4" /></button>
          <button onClick={() => zoom(0.83)} className="w-8 h-8 bg-white border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-50 shadow-sm"><ZoomOut className="w-4 h-4" /></button>
          <button onClick={reset} className="w-8 h-8 bg-white border border-gray-200 rounded-lg flex items-center justify-center text-gray-600 hover:bg-gray-50 shadow-sm" title="Reiniciar"><Maximize2 className="w-4 h-4" /></button>
        </div>

        <svg
          ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full touch-none select-none cursor-grab active:cursor-grabbing"
          style={{ aspectRatio: `${W}/${H}` }}
          onPointerDown={onPointerDownBg} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}
        >
          <g transform={`translate(${view.x} ${view.y}) scale(${view.s})`}>
            {/* Edges */}
            {EDGES.map(([a, b], i) => {
              const pa = pos[a], pb = pos[b]; if (!pa || !pb) return null
              const activo = sel === a || sel === b
              return (
                <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                  stroke={activo ? '#16a34a' : '#e5e7eb'} strokeWidth={activo ? 2 : 1} opacity={sel && !activo ? 0.25 : 1} />
              )
            })}
            {/* Nodos */}
            {NODOS.map(n => {
              const p = pos[n.id]; if (!p) return null
              const color = DOMINIOS[n.dominio].color
              const activo = sel === n.id
              const cerca = conectados.has(n.id)
              const atenuado = sel && !activo && !cerca
              return (
                <g key={n.id} transform={`translate(${p.x} ${p.y})`} className="cursor-pointer"
                  opacity={atenuado ? 0.3 : 1}
                  onPointerDown={e => onPointerDownNode(e, n.id)}>
                  <circle r={activo ? 13 : 9} fill={color} stroke="#fff" strokeWidth={activo ? 3 : 2} />
                  <text x={0} y={activo ? 30 : 24} textAnchor="middle" className="font-mono"
                    style={{ fontSize: 12, fontWeight: activo ? 700 : 500, fill: '#374151', paintOrder: 'stroke', stroke: '#fff', strokeWidth: 3 }}>
                    {n.label}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>

        <p className="absolute bottom-2 left-3 font-body text-xs text-gray-400">Arrastra los nodos · arrastra el fondo para mover · clic en una tabla para ver sus relaciones</p>
      </div>

      {/* Panel lateral */}
      <div className="space-y-4">
        {/* Leyenda */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm">
          <p className="font-heading font-semibold text-sm text-gray-900 mb-2 flex items-center gap-1.5"><Database className="w-4 h-4 text-brand-green" /> Dominios</p>
          <div className="space-y-1.5">
            {Object.entries(DOMINIOS).map(([k, d]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full" style={{ background: d.color }} />
                <span className="font-body text-sm text-gray-600">{d.nombre}</span>
                <span className="font-body text-xs text-gray-300 ml-auto">{NODOS.filter(n => n.dominio === k).length}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Relaciones del nodo seleccionado */}
        <div className="bg-white border border-gray-100 rounded-2xl p-4 shadow-sm min-h-[180px]">
          {sel ? (
            <>
              <p className="font-mono font-bold text-sm text-gray-900">{sel}</p>
              <p className="font-body text-xs text-gray-400 mb-3">{relaciones.length} relación{relaciones.length === 1 ? '' : 'es'}</p>
              <div className="space-y-1.5 max-h-[320px] overflow-y-auto">
                {relaciones.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${r.dir === 'out' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>{r.dir === 'out' ? '→' : '←'}</span>
                    <span className="font-mono text-xs text-gray-700">{r.otro}</span>
                    <span className="font-body text-xs text-gray-400 ml-auto">{r.via}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="font-body text-sm text-gray-400">Selecciona una tabla en el grafo para ver con qué se relaciona y por qué campo.</p>
          )}
        </div>
      </div>
    </div>
  )
}

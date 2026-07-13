'use client'

import { useState } from 'react'
import { Layers } from 'lucide-react'
import { ELEMENTOS, type PlanoElemento, type PlanoPiso } from './plano/plano-tipos'

/** Visor de solo lectura del plano diseñado (pisos + elementos). */
export function PlanoViewer({ pisos }: { pisos: PlanoPiso[] }) {
  const conDiseno = pisos.filter(p => (p.elementos?.length ?? 0) > 0)
  const [activeId, setActiveId] = useState<string | null>(conDiseno[0]?.id ?? pisos[0]?.id ?? null)
  const piso = pisos.find(p => p.id === activeId) ?? conDiseno[0] ?? pisos[0] ?? null
  if (!piso) return null

  const elementos = piso.elementos ?? []
  // Escala de visualización: ajusta el plano al ancho disponible.
  const escala = Math.max(8, Math.min(piso.escala, 820 / piso.ancho_m, 560 / piso.alto_m))
  const W = piso.ancho_m * escala
  const H = piso.alto_m * escala

  return (
    <div className="p-3 space-y-2">
      {pisos.length > 1 && (
        <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 overflow-x-auto w-fit">
          {pisos.map(p => (
            <button key={p.id} onClick={() => setActiveId(p.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-body text-xs font-semibold whitespace-nowrap transition-colors ${
                p.id === piso.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
              <Layers className="w-3.5 h-3.5" /> {p.nombre ?? `Piso ${p.numero}`}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-auto max-h-[60vh] rounded-xl border border-gray-100 bg-gray-50 p-2">
        <svg width={W + 24} height={H + 24} style={{ minWidth: W + 24 }}>
          <g transform="translate(20,20)">
            <rect x={0} y={0} width={W} height={H} fill="#ffffff" stroke="#e5e7eb" />
            {/* Cuadrícula cada 1 m (marcada cada 5 m) */}
            {Array.from({ length: Math.floor(piso.ancho_m) + 1 }, (_, i) => (
              <line key={`vx${i}`} x1={i * escala} y1={0} x2={i * escala} y2={H} stroke={i % 5 === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth={1} />
            ))}
            {Array.from({ length: Math.floor(piso.alto_m) + 1 }, (_, i) => (
              <line key={`hy${i}`} x1={0} y1={i * escala} x2={W} y2={i * escala} stroke={i % 5 === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth={1} />
            ))}
            {elementos.map(e => <ElementoView key={e.id} e={e} escala={escala} />)}
          </g>
          {/* Regla en metros */}
          {Array.from({ length: Math.floor(piso.ancho_m) + 1 }, (_, i) => i % 2 === 0 && (
            <text key={`rx${i}`} x={20 + i * escala} y={12} fontSize={8} fill="#9ca3af" textAnchor="middle">{i}</text>
          ))}
          {Array.from({ length: Math.floor(piso.alto_m) + 1 }, (_, i) => i % 2 === 0 && (
            <text key={`ry${i}`} x={9} y={20 + i * escala + 3} fontSize={8} fill="#9ca3af" textAnchor="middle">{i}</text>
          ))}
        </svg>
      </div>
      <p className="font-body text-xs text-gray-400">
        {piso.ancho_m} × {piso.alto_m} m · {(piso.ancho_m * piso.alto_m).toFixed(1)} m² · {elementos.length} elementos
      </p>
    </div>
  )
}

function ElementoView({ e, escala }: { e: PlanoElemento; escala: number }) {
  const cfg = ELEMENTOS[e.tipo]
  if (!cfg) return null
  const x = e.x * escala, y = e.y * escala, w = e.w * escala, h = e.h * escala
  const fill = e.color ?? cfg.color
  const cx = w / 2, cy = h / 2
  const texto = w > 30 && h > 16

  return (
    <g transform={`translate(${x},${y}) rotate(${e.rot} ${cx} ${cy})`}>
      {cfg.render === 'etiqueta' ? (
        <rect width={w} height={h} rx={3} fill="transparent" stroke={cfg.borde} strokeDasharray="4 3" />
      ) : (
        <rect width={w} height={h} rx={cfg.render === 'columna' ? Math.min(w, h) / 2 : 3}
          fill={fill} fillOpacity={e.tipo === 'PASILLO' || e.tipo === 'ALMACEN' || e.tipo === 'ZONA_CARGA' ? 0.5 : 0.9}
          stroke={cfg.borde} strokeWidth={1.25} />
      )}
      {cfg.render === 'puerta' && (
        <path d={`M0,${h} A${Math.max(w, 16)},${Math.max(w, 16)} 0 0 1 ${Math.max(w, 16)},0`} fill="none" stroke={cfg.borde} strokeWidth={1} strokeDasharray="3 3" />
      )}
      {cfg.render === 'escalera' && Array.from({ length: Math.max(2, Math.floor(h / 10)) }, (_, i) => (
        <line key={i} x1={0} y1={(i + 1) * (h / Math.max(2, Math.floor(h / 10)))} x2={w} y2={(i + 1) * (h / Math.max(2, Math.floor(h / 10)))} stroke={cfg.borde} strokeWidth={0.75} />
      ))}
      {cfg.render === 'ventana' && <line x1={0} y1={h / 2} x2={w} y2={h / 2} stroke={cfg.borde} strokeWidth={1} />}
      {texto && <text x={cx} y={cy + 3} fontSize={9} fill="#1f2937" textAnchor="middle" style={{ fontWeight: 600 }}>{e.etiqueta || cfg.label}</text>}
    </g>
  )
}

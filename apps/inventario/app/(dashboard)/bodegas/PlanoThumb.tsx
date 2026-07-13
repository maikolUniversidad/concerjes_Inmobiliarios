import { ELEMENTOS, type PlanoElemento } from './[id]/plano/plano-tipos'

/** Miniatura del plano (solo lectura, autoescalada) para tarjetas/listados. */
export function PlanoThumb({ ancho_m, alto_m, elementos }: { ancho_m: number; alto_m: number; elementos: PlanoElemento[] }) {
  return (
    <svg
      viewBox={`-0.3 -0.3 ${ancho_m + 0.6} ${alto_m + 0.6}`}
      preserveAspectRatio="xMidYMid meet"
      className="w-full h-full"
    >
      <rect x={0} y={0} width={ancho_m} height={alto_m} fill="#ffffff" stroke="#e5e7eb" strokeWidth={0.05} />
      {/* Cuadrícula cada 1 m */}
      {Array.from({ length: Math.floor(ancho_m) + 1 }, (_, i) => (
        <line key={`vx${i}`} x1={i} y1={0} x2={i} y2={alto_m} stroke={i % 5 === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth={0.02} />
      ))}
      {Array.from({ length: Math.floor(alto_m) + 1 }, (_, i) => (
        <line key={`hy${i}`} x1={0} y1={i} x2={ancho_m} y2={i} stroke={i % 5 === 0 ? '#e5e7eb' : '#f3f4f6'} strokeWidth={0.02} />
      ))}
      {elementos.map(e => {
        const cfg = ELEMENTOS[e.tipo]
        if (!cfg) return null
        const cx = e.w / 2, cy = e.h / 2
        return (
          <g key={e.id} transform={`translate(${e.x},${e.y}) rotate(${e.rot} ${cx} ${cy})`}>
            <rect width={e.w} height={e.h} rx={0.08}
              fill={e.color ?? cfg.color}
              fillOpacity={e.tipo === 'PASILLO' || e.tipo === 'ALMACEN' || e.tipo === 'ZONA_CARGA' ? 0.5 : 0.9}
              stroke={cfg.borde} strokeWidth={0.04} />
          </g>
        )
      })}
    </svg>
  )
}

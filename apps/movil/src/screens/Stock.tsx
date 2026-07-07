import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, Boxes, AlertCircle } from 'lucide-react'
import { db } from '../lib/db'
import { EVENTO_SYNC } from '../components/Layout'

interface Prod { id: string; ref: number | null; nombre_estandar: string; presentacion: string | null; cat_rotacion: string; stock_minimo_def: number; activo?: boolean }
interface St { producto_id: string; cantidad_real: number; cantidad_disp: number; cantidad_entr: number; cantidad_sal: number }

function estado(real: number, min: number) {
  if (real === 0) return { t: 'Agotado', c: 'bg-red-100 text-red-700' }
  if (min > 0 && real <= min) return { t: 'Crítico', c: 'bg-orange-100 text-orange-700' }
  if (min > 0 && real <= min * 1.5) return { t: 'Bajo', c: 'bg-yellow-100 text-yellow-700' }
  return { t: 'Normal', c: 'bg-green-100 text-green-700' }
}

export function Stock() {
  const [prods, setProds] = useState<Prod[]>([])
  const [stMap, setStMap] = useState<Record<string, St>>({})
  const [q, setQ] = useState('')

  const cargar = useCallback(async () => {
    const [p, s] = await Promise.all([
      db.table('productos').toArray() as Promise<Prod[]>,
      db.table('stock').toArray() as Promise<St[]>,
    ])
    setProds(p.filter(x => x.activo !== false).sort((a, b) => a.nombre_estandar.localeCompare(b.nombre_estandar)))
    setStMap(Object.fromEntries(s.map(x => [x.producto_id, x])))
  }, [])

  useEffect(() => { cargar(); const h = () => cargar(); window.addEventListener(EVENTO_SYNC, h); return () => window.removeEventListener(EVENTO_SYNC, h) }, [cargar])

  const kpi = useMemo(() => {
    let unidades = 0, criticos = 0
    for (const p of prods) {
      const real = stMap[p.id]?.cantidad_real ?? 0
      unidades += Number(real)
      if (p.stock_minimo_def > 0 && real <= p.stock_minimo_def) criticos++
    }
    return { unidades, criticos }
  }, [prods, stMap])

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase()
    const base = t ? prods.filter(p => p.nombre_estandar.toLowerCase().includes(t) || String(p.ref ?? '').includes(t)) : prods
    return base.slice(0, 200)
  }, [prods, q])

  return (
    <div className="p-4 space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-white border border-gray-100 rounded-2xl p-3 flex items-center gap-2">
          <Boxes className="w-5 h-5 text-blue-600" />
          <div><p className="font-bold text-lg leading-none">{kpi.unidades.toLocaleString('es-CO')}</p><p className="text-[11px] text-gray-500">unidades</p></div>
        </div>
        <div className="bg-white border border-gray-100 rounded-2xl p-3 flex items-center gap-2">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <div><p className="font-bold text-lg leading-none">{kpi.criticos}</p><p className="text-[11px] text-gray-500">en alerta</p></div>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2.5">
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar producto…" className="flex-1 text-sm outline-none" />
      </div>

      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden divide-y divide-gray-50">
        {filtrados.map(p => {
          const s = stMap[p.id]
          const real = s?.cantidad_real ?? 0
          const e = estado(Number(real), p.stock_minimo_def)
          return (
            <div key={p.id} className="px-3 py-2.5 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-gray-900 truncate">{p.nombre_estandar}</p>
                <p className="text-[11px] text-gray-400">{p.presentacion} · disp {s?.cantidad_disp ?? 0}</p>
              </div>
              <div className="text-right">
                <p className="font-bold text-base text-gray-900">{Number(real)}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${e.c}`}>{e.t}</span>
              </div>
            </div>
          )
        })}
        {filtrados.length === 0 && <p className="text-center text-sm text-gray-400 py-8">Sin datos. Sincroniza con conexión.</p>}
      </div>
    </div>
  )
}

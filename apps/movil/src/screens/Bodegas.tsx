import { useCallback, useEffect, useMemo, useState } from 'react'
import { Warehouse, MapPin, ChevronRight } from 'lucide-react'
import { db } from '../lib/db'
import { EVENTO_SYNC } from '../components/Layout'

interface Bodega { id: string; nombre: string; codigo: string | null; direccion: string | null; activo?: boolean }
interface Ubic { id: string; bodega_id: string; codigo: string; nombre: string | null; tipo: string | null; activo?: boolean }

export function Bodegas() {
  const [bodegas, setBodegas] = useState<Bodega[]>([])
  const [ubics, setUbics] = useState<Ubic[]>([])
  const [abierta, setAbierta] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    const [b, u] = await Promise.all([
      db.table('bodegas').toArray() as Promise<Bodega[]>,
      db.table('ubicaciones').toArray() as Promise<Ubic[]>,
    ])
    setBodegas(b.filter(x => x.activo !== false))
    setUbics(u.filter(x => x.activo !== false))
  }, [])
  useEffect(() => { cargar(); const h = () => cargar(); window.addEventListener(EVENTO_SYNC, h); return () => window.removeEventListener(EVENTO_SYNC, h) }, [cargar])

  const porBodega = useMemo(() => {
    const m: Record<string, Ubic[]> = {}
    for (const u of ubics) (m[u.bodega_id] ??= []).push(u)
    return m
  }, [ubics])

  return (
    <div className="p-4 space-y-3">
      {bodegas.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><Warehouse className="w-10 h-10 mx-auto mb-2 text-gray-300" /><p className="text-sm">Sin bodegas. Sincroniza con conexión.</p></div>
      ) : bodegas.map(b => {
        const us = porBodega[b.id] ?? []
        const open = abierta === b.id
        return (
          <div key={b.id} className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
            <button onClick={() => setAbierta(open ? null : b.id)} className="w-full flex items-center gap-3 p-3 text-left">
              <div className="w-9 h-9 rounded-xl bg-brand-green/10 flex items-center justify-center"><Warehouse className="w-4 h-4 text-brand-green" /></div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-gray-900">{b.nombre}</p>
                <p className="text-[11px] text-gray-400">{b.codigo ? `${b.codigo} · ` : ''}{us.length} ubicaciones</p>
              </div>
              <ChevronRight className={`w-4 h-4 text-gray-300 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
            {open && (
              <div className="border-t border-gray-50 divide-y divide-gray-50">
                {us.length === 0 ? <p className="text-xs text-gray-400 px-4 py-3">Sin ubicaciones.</p> : us.map(u => (
                  <div key={u.id} className="flex items-center gap-2 px-4 py-2">
                    <MapPin className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    <span className="font-mono text-xs text-gray-500">{u.codigo}</span>
                    <span className="text-sm text-gray-700 truncate">{u.nombre}</span>
                    <span className="text-[10px] text-gray-400 ml-auto">{u.tipo}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

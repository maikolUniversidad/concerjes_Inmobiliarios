import { useCallback, useEffect, useState } from 'react'
import { ClipboardCheck, CheckCircle2, Clock } from 'lucide-react'
import { db } from '../lib/db'
import { EVENTO_SYNC } from '../components/Layout'

interface Arq { id: string; nombre: string; estado: string; total_items: number; items_contados: number; items_con_diferencia: number; created_at: string }

export function Arqueo() {
  const [arqueos, setArqueos] = useState<Arq[]>([])

  const cargar = useCallback(async () => {
    // created_at no es índice en Dexie (arqueos indexa updated_at) → ordenamos en memoria.
    const a = (await db.table('arqueos').toArray() as Arq[]).sort((x, y) => (y.created_at ?? '').localeCompare(x.created_at ?? ''))
    setArqueos(a)
  }, [])
  useEffect(() => { cargar(); const h = () => cargar(); window.addEventListener(EVENTO_SYNC, h); return () => window.removeEventListener(EVENTO_SYNC, h) }, [cargar])

  return (
    <div className="p-4 space-y-3">
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-3">
        <p className="text-xs text-blue-800">El conteo colaborativo en tiempo real se hace en la web. Aquí puedes consultar los arqueos sincronizados sin conexión.</p>
      </div>
      {arqueos.length === 0 ? (
        <div className="text-center py-16 text-gray-400"><ClipboardCheck className="w-10 h-10 mx-auto mb-2 text-gray-300" /><p className="text-sm">Sin arqueos. Sincroniza con conexión.</p></div>
      ) : arqueos.map(a => {
        const prog = a.total_items > 0 ? Math.round((a.items_contados / a.total_items) * 100) : 0
        const cerrado = a.estado === 'CERRADO'
        return (
          <div key={a.id} className="bg-white border border-gray-100 rounded-2xl p-3">
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="font-bold text-sm text-gray-900 truncate">{a.nombre}</p>
              <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full ${cerrado ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                {cerrado ? <CheckCircle2 className="w-3 h-3" /> : <Clock className="w-3 h-3" />}{cerrado ? 'Cerrado' : 'En progreso'}
              </span>
            </div>
            {cerrado ? (
              <p className="text-xs text-gray-500">{a.items_con_diferencia} con diferencia · {a.items_contados}/{a.total_items} contados</p>
            ) : (
              <>
                <div className="flex justify-between text-[11px] text-gray-500 mb-1"><span>{a.items_contados}/{a.total_items}</span><span>{prog}%</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-brand-green rounded-full" style={{ width: `${prog}%` }} /></div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

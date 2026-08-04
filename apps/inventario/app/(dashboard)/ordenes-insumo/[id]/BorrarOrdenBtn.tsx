'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { borrarOrden } from '../actions'

/**
 * Borra la orden por completo. Solo aparece para estados que no movieron
 * inventario (para despachadas/entregadas se usa Anular). Al borrar, vuelve a
 * la lista de órdenes.
 */
export function BorrarOrdenBtn({ ordenId, numero }: { ordenId: string; numero: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()

  function borrar() {
    if (!window.confirm(`¿Borrar definitivamente la orden ${numero}? Esta acción no se puede deshacer.`)) return
    start(async () => {
      const r = await borrarOrden(ordenId)
      if (r.error) { toast.error(r.error); return }
      toast.success('Orden borrada.')
      router.push('/ordenes-insumo')
      router.refresh()
    })
  }

  return (
    <div className="flex justify-end">
      <button onClick={borrar} disabled={pending}
        className="inline-flex items-center gap-1.5 border border-red-200 text-red-600 font-body text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50">
        {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
        Borrar orden
      </button>
    </div>
  )
}

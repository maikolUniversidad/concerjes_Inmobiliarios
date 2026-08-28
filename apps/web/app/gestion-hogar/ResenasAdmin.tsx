'use client'

import { useEffect, useState } from 'react'
import { Loader2, Star, Check, EyeOff, Trash2, MessageSquare } from 'lucide-react'
import { toast } from 'sonner'
import { getGestionSupabase } from '@/lib/supabase/gestion'
import { traerTodo } from '@/lib/supabase/paginado'

interface Resena {
  id: string; cliente_nombre: string; servicio_nombre: string | null
  calificacion: number; comentario: string | null; aprobada: boolean; created_at: string
}

export function ResenasAdmin() {
  const [items, setItems] = useState<Resena[]>([])
  const [cargando, setCargando] = useState(true)
  const [filtro, setFiltro] = useState<'pendientes' | 'aprobadas'>('pendientes')

  async function cargar() {
    const sb = getGestionSupabase()
    // Paginado (PostgREST devuelve máximo 1.000 filas por respuesta).
    const data = await traerTodo((desde, hasta) => sb.from('resenas_servicio_hogar')
      .select('id, cliente_nombre, servicio_nombre, calificacion, comentario, aprobada, created_at')
      .order('created_at', { ascending: false }).order('id')
      .range(desde, hasta))
    setItems(data as Resena[])
    setCargando(false)
  }
  useEffect(() => { cargar() }, [])

  async function setAprobada(id: string, aprobada: boolean) {
    const sb = getGestionSupabase()
    const { error } = await sb.from('resenas_servicio_hogar').update({ aprobada }).eq('id', id)
    if (error) { toast.error('No se pudo actualizar.'); return }
    toast.success(aprobada ? 'Reseña publicada.' : 'Reseña ocultada.')
    cargar()
  }

  async function eliminar(id: string) {
    const sb = getGestionSupabase()
    const { error } = await sb.from('resenas_servicio_hogar').delete().eq('id', id)
    if (error) { toast.error('No se pudo eliminar.'); return }
    toast.success('Reseña eliminada.')
    cargar()
  }

  const visibles = items.filter((r) => (filtro === 'pendientes' ? !r.aprobada : r.aprobada))
  const nPend = items.filter((r) => !r.aprobada).length

  return (
    <div className="space-y-5">
      <div className="flex rounded-xl bg-gray-100 p-1">
        <button onClick={() => setFiltro('pendientes')} className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${filtro === 'pendientes' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}>
          Pendientes{nPend > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-xs text-white">{nPend}</span>}
        </button>
        <button onClick={() => setFiltro('aprobadas')} className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${filtro === 'aprobadas' ? 'bg-white text-brand-green shadow-sm' : 'text-gray-500'}`}>
          Publicadas
        </button>
      </div>

      {cargando ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-brand-green" /></div>
      ) : visibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-10 text-center text-gray-400">
          <MessageSquare className="mx-auto h-8 w-8" />
          <p className="mt-2 text-sm">{filtro === 'pendientes' ? 'No hay reseñas pendientes de aprobación.' : 'Aún no hay reseñas publicadas.'}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {visibles.map((r) => (
            <div key={r.id} className="rounded-2xl border border-gray-200 bg-white p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-heading font-bold text-gray-900">{r.cliente_nombre}</p>
                    <div className="flex">
                      {[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`h-4 w-4 ${i <= r.calificacion ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />)}
                    </div>
                  </div>
                  {r.servicio_nombre && <p className="text-xs text-gray-400">{r.servicio_nombre} · {new Date(r.created_at).toLocaleDateString('es-CO')}</p>}
                </div>
              </div>
              {r.comentario && <p className="mt-2 text-gray-700">“{r.comentario}”</p>}
              <div className="mt-4 flex flex-wrap gap-2">
                {!r.aprobada ? (
                  <button onClick={() => setAprobada(r.id, true)} className="inline-flex items-center gap-1.5 rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:bg-brand-green-dark">
                    <Check className="h-4 w-4" /> Aprobar y publicar
                  </button>
                ) : (
                  <button onClick={() => setAprobada(r.id, false)} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100">
                    <EyeOff className="h-4 w-4" /> Ocultar
                  </button>
                )}
                <button onClick={() => eliminar(r.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50">
                  <Trash2 className="h-4 w-4" /> Eliminar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

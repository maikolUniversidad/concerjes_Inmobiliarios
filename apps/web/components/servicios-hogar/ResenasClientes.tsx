'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Star, Quote, MessageSquarePlus } from 'lucide-react'
import { getPublico } from '@/lib/supabase/publico'

interface Resena {
  id: string
  cliente_nombre: string
  servicio_nombre: string | null
  calificacion: number
  comentario: string | null
  created_at: string
}

function Estrellas({ n, className = 'h-4 w-4' }: { n: number; className?: string }) {
  return (
    <div className="flex">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`${className} ${i <= n ? 'fill-amber-400 text-amber-400' : 'text-gray-300'}`} />
      ))}
    </div>
  )
}

export function ResenasClientes() {
  const [resenas, setResenas] = useState<Resena[]>([])
  const [cargando, setCargando] = useState(true)

  useEffect(() => {
    getPublico()
      .from('resenas_servicio_hogar')
      .select('id, cliente_nombre, servicio_nombre, calificacion, comentario, created_at')
      .eq('aprobada', true)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(({ data }) => {
        setResenas((data as Resena[]) ?? [])
        setCargando(false)
      })
  }, [])

  if (cargando || resenas.length === 0) return null

  const promedio = resenas.reduce((a, r) => a + r.calificacion, 0) / resenas.length

  return (
    <section id="resenas" className="py-20 px-4">
      <div className="container-max">
        <div className="text-center mb-14">
          <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 text-sm font-body font-semibold px-4 py-1.5 rounded-full mb-4">
            <Star className="w-4 h-4 fill-amber-500 text-amber-500" /> Reseñas verificadas
          </span>
          <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
            Lo que dicen nuestros clientes
          </h2>
          <div className="flex items-center justify-center gap-3">
            <span className="font-heading text-4xl font-bold text-gray-900">{promedio.toFixed(1)}</span>
            <div>
              <Estrellas n={Math.round(promedio)} className="h-5 w-5" />
              <p className="text-sm text-gray-500 font-body mt-0.5">{resenas.length} reseña{resenas.length === 1 ? '' : 's'} de clientes reales</p>
            </div>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {resenas.slice(0, 9).map((r) => (
            <div key={r.id} className="relative rounded-2xl border border-gray-100 bg-white p-6 shadow-sm">
              <Quote className="absolute right-5 top-5 h-8 w-8 text-brand-green/10" />
              <Estrellas n={r.calificacion} />
              {r.comentario && (
                <p className="mt-3 text-gray-700 font-body leading-relaxed">“{r.comentario}”</p>
              )}
              <div className="mt-4 flex items-center gap-3 border-t border-gray-100 pt-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-green/10 font-heading font-bold text-brand-green">
                  {r.cliente_nombre.charAt(0).toUpperCase()}
                </div>
                <div>
                  <p className="font-body font-semibold text-gray-900">{r.cliente_nombre}</p>
                  {r.servicio_nombre && <p className="text-xs text-gray-400">{r.servicio_nombre}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-10 text-center">
          <Link href="/portal" className="inline-flex items-center gap-2 rounded-xl border-2 border-brand-green px-6 py-3 font-body font-semibold text-brand-green transition-colors hover:bg-brand-green/5">
            <MessageSquarePlus className="h-5 w-5" /> ¿Ya usaste el servicio? Deja tu reseña
          </Link>
        </div>
      </div>
    </section>
  )
}

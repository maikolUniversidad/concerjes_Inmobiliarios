'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, ImageIcon } from 'lucide-react'
import { getPublico } from '@/lib/supabase/publico'

interface Foto {
  id: string
  titulo: string | null
  descripcion: string | null
  url: string
  tipos_servicio_hogar: { nombre: string } | null
}

export function GaleriaServicios() {
  const [fotos, setFotos] = useState<Foto[]>([])
  const [cargando, setCargando] = useState(true)
  const [activa, setActiva] = useState<number | null>(null)

  useEffect(() => {
    getPublico()
      .from('galeria_servicio_hogar')
      .select('id, titulo, descripcion, url, tipos_servicio_hogar(nombre)')
      .eq('activo', true)
      .order('orden', { ascending: true })
      .order('created_at', { ascending: false })
      .limit(60)
      .then(({ data }) => {
        setFotos((data as unknown as Foto[]) ?? [])
        setCargando(false)
      })
  }, [])

  const cerrar = useCallback(() => setActiva(null), [])
  const mover = useCallback((d: number) => {
    setActiva((i) => (i === null ? null : (i + d + fotos.length) % fotos.length))
  }, [fotos.length])

  useEffect(() => {
    if (activa === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
      if (e.key === 'ArrowRight') mover(1)
      if (e.key === 'ArrowLeft') mover(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activa, cerrar, mover])

  // No renderizar la sección si no hay fotos (evita bloque vacío en marketing).
  if (!cargando && fotos.length === 0) return null

  return (
    <section id="galeria" className="py-20 px-4 bg-gray-50">
      <div className="container-max">
        <div className="text-center mb-14">
          <span className="inline-flex items-center gap-1.5 bg-brand-green/10 text-brand-green text-sm font-body font-semibold px-4 py-1.5 rounded-full mb-4">
            <ImageIcon className="w-4 h-4" /> Galería
          </span>
          <h2 className="font-heading font-bold text-3xl sm:text-4xl text-gray-900 mb-4">
            Nuestro trabajo habla por nosotros
          </h2>
          <p className="text-gray-500 font-body text-lg max-w-xl mx-auto">
            Resultados reales de nuestros servicios de limpieza y atención en el hogar.
          </p>
        </div>

        {cargando ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square rounded-xl bg-gray-200 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {fotos.map((f, i) => (
              <button
                key={f.id}
                onClick={() => setActiva(i)}
                className="group relative aspect-square overflow-hidden rounded-xl bg-gray-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={f.url}
                  alt={f.titulo ?? 'Servicio del hogar'}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                {(f.titulo || f.tipos_servicio_hogar?.nombre) && (
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
                    <p className="text-left text-sm font-semibold text-white">{f.titulo ?? f.tipos_servicio_hogar?.nombre}</p>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {activa !== null && fotos[activa] && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4" onClick={cerrar}>
          <button onClick={cerrar} className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <X className="h-6 w-6" />
          </button>
          {fotos.length > 1 && (
            <>
              <button onClick={(e) => { e.stopPropagation(); mover(-1) }} className="absolute left-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button onClick={(e) => { e.stopPropagation(); mover(1) }} className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                <ChevronRight className="h-7 w-7" />
              </button>
            </>
          )}
          <figure className="max-h-[85vh] max-w-4xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fotos[activa].url} alt={fotos[activa].titulo ?? ''} className="max-h-[80vh] w-auto rounded-xl object-contain" />
            {(fotos[activa].titulo || fotos[activa].descripcion) && (
              <figcaption className="mt-3 text-center text-white">
                {fotos[activa].titulo && <p className="font-heading font-bold">{fotos[activa].titulo}</p>}
                {fotos[activa].descripcion && <p className="text-sm text-white/70">{fotos[activa].descripcion}</p>}
              </figcaption>
            )}
          </figure>
        </div>
      )}
    </section>
  )
}

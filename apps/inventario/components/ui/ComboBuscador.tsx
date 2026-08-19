'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, Check, ChevronDown } from 'lucide-react'

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')

interface Pos { top: number; left: number; width: number; arriba: boolean; alto: number }

/**
 * Selector con buscador para listas largas.
 *
 * El desplegable se dibuja en un portal con posición fija: así no lo recorta el
 * `overflow` de la tabla o de la tarjeta que lo contiene (antes quedaba oculto
 * debajo del contenedor). Si no cabe abajo, se abre hacia arriba.
 *
 * Búsqueda tolerante: sin tildes, por varias palabras y en cualquier orden.
 */
export function ComboBuscador<T>({
  items, value, onPick, getId, textoBusqueda, fila, etiqueta,
  placeholder = '— Selecciona —', buscarPlaceholder = 'Escribe para buscar…',
  sinResultados = 'Sin resultados', maximo = 50, className = '', disabled = false,
}: {
  items: T[]
  /** id del elemento seleccionado ('' si no hay). */
  value: string
  onPick: (item: T) => void
  getId: (item: T) => string
  /** Texto sobre el que se busca (nombre, código, sede…). */
  textoBusqueda: (item: T) => string
  /** Cómo se pinta cada opción de la lista. */
  fila: (item: T, seleccionado: boolean) => React.ReactNode
  /** Qué se ve en el botón cuando hay selección. */
  etiqueta: (item: T) => React.ReactNode
  placeholder?: string
  buscarPlaceholder?: string
  sinResultados?: string
  /** Tope de opciones mostradas a la vez (la búsqueda recorta la lista). */
  maximo?: number
  className?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [activo, setActivo] = useState(0)
  const [pos, setPos] = useState<Pos | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const listaRef = useRef<HTMLDivElement>(null)

  const sel = items.find(i => getId(i) === value) ?? null

  const filtrados = useMemo(() => {
    const query = norm(q.trim())
    if (!query) return items.slice(0, maximo)
    const tokens = query.split(/\s+/)
    return items.filter(i => {
      const heno = norm(textoBusqueda(i))
      return tokens.every(t => heno.includes(t))
    }).slice(0, maximo)
    // textoBusqueda/getId son estables en la práctica (funciones puras del render)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, q, maximo])

  // Ancla el desplegable al botón; se recalcula al abrir, al hacer scroll y al
  // cambiar el tamaño de la ventana.
  const medir = useCallback(() => {
    const el = btnRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margen = 8
    const abajo = window.innerHeight - r.bottom - margen
    const arriba = r.top - margen
    const cabeAbajo = abajo >= 220 || abajo >= arriba
    setPos({
      top: cabeAbajo ? r.bottom + 4 : r.top - 4,
      left: r.left,
      width: r.width,
      arriba: !cabeAbajo,
      alto: Math.max(160, Math.min(340, cabeAbajo ? abajo : arriba)),
    })
  }, [])

  useEffect(() => { if (open) medir() }, [open, medir])

  useEffect(() => {
    if (!open) return
    const onScroll = () => medir()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, medir])

  function cerrar() { setOpen(false); setQ(''); setActivo(0) }

  function elegir(item: T) { onPick(item); cerrar() }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); cerrar(); return }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActivo(a => {
        const n = filtrados.length
        if (n === 0) return 0
        return e.key === 'ArrowDown' ? (a + 1) % n : (a - 1 + n) % n
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = filtrados[activo]
      if (item) elegir(item)
    }
  }

  // Mantiene visible la opción marcada con el teclado.
  useEffect(() => {
    const cont = listaRef.current
    if (!cont) return
    const el = cont.querySelector<HTMLElement>(`[data-idx="${activo}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activo, filtrados.length])

  const desplegable = open && pos && (
    <>
      <div className="fixed inset-0 z-[60]" onMouseDown={cerrar} />
      <div
        className="fixed z-[61] rounded-xl border border-gray-200 bg-white shadow-2xl"
        style={{
          top: pos.arriba ? undefined : pos.top,
          bottom: pos.arriba ? window.innerHeight - pos.top : undefined,
          left: pos.left,
          width: Math.max(pos.width, 260),
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input autoFocus value={q} onKeyDown={onKeyDown}
            onChange={e => { setQ(e.target.value); setActivo(0) }}
            placeholder={buscarPlaceholder}
            className="flex-1 bg-transparent font-body text-sm outline-none placeholder:text-gray-400" />
        </div>
        <div ref={listaRef} className="overflow-y-auto py-1" style={{ maxHeight: pos.alto }}>
          {filtrados.length === 0 ? (
            <p className="px-3 py-3 font-body text-sm text-gray-400">
              {sinResultados}{q.trim() ? ` para «${q.trim()}»` : ''}.
            </p>
          ) : filtrados.map((item, i) => {
            const id = getId(item)
            const esSel = id === value
            return (
              <button key={id} type="button" data-idx={i}
                onMouseEnter={() => setActivo(i)}
                onClick={() => elegir(item)}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left ${
                  i === activo ? 'bg-green-50' : esSel ? 'bg-green-50/60' : ''}`}>
                <span className="min-w-0 flex-1">{fila(item, esSel)}</span>
                {esSel && <Check className="w-4 h-4 text-brand-green shrink-0" />}
              </button>
            )
          })}
          {items.length > filtrados.length && (
            <p className="px-3 py-2 font-body text-[11px] text-gray-400 border-t border-gray-50">
              Mostrando {filtrados.length} de {items.length}. Escribe para afinar la búsqueda.
            </p>
          )}
        </div>
      </div>
    </>
  )

  return (
    <div className={`relative ${className}`}>
      <button ref={btnRef} type="button" disabled={disabled} onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-2 rounded-lg border border-gray-200 px-2.5 py-1.5 font-body text-sm text-left outline-none focus:border-brand-green bg-white disabled:bg-gray-50 disabled:text-gray-400">
        <span className={`min-w-0 flex-1 truncate ${sel ? 'text-gray-800' : 'text-gray-400'}`}>
          {sel ? etiqueta(sel) : placeholder}
        </span>
        {open ? <Search className="w-3.5 h-3.5 text-brand-green shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
      </button>
      {typeof document !== 'undefined' && desplegable ? createPortal(desplegable, document.body) : null}
    </div>
  )
}

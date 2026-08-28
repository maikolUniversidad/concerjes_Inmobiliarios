'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownAZ, ArrowUpAZ, Check, Filter, Search, X } from 'lucide-react'
import type { DireccionOrden, FiltroColumna as EstadoFiltro } from './tipos'

interface Props {
  titulo: string
  /** Valores distintos de la columna, ya filtrados por las demás columnas. */
  valoresUnicos: string[]
  filtro: EstadoFiltro
  orden: DireccionOrden | null
  ordenable: boolean
  onOrden: (direccion: DireccionOrden | null) => void
  onCambio: (filtro: EstadoFiltro) => void
}

const VACIO = '(Vacías)'
const TOPE_LISTA = 500

export function FiltroColumnaMenu({
  titulo,
  valoresUnicos,
  filtro,
  orden,
  ordenable,
  onOrden,
  onCambio,
}: Props) {
  const [abierto, setAbierto] = useState(false)
  const [buscar, setBuscar] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const botonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const activo = filtro.texto.trim() !== '' || filtro.valores !== null

  useLayoutEffect(() => {
    if (!abierto || !botonRef.current) return
    const r = botonRef.current.getBoundingClientRect()
    const ancho = 260
    const left = Math.min(Math.max(8, r.left - ancho + r.width), window.innerWidth - ancho - 8)
    setPos({ top: r.bottom + 6, left })
  }, [abierto])

  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || botonRef.current?.contains(t)) return
      setAbierto(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    const cerrar = () => setAbierto(false)
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', escape)
    window.addEventListener('resize', cerrar)
    window.addEventListener('scroll', cerrar, true)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', escape)
      window.removeEventListener('resize', cerrar)
      window.removeEventListener('scroll', cerrar, true)
    }
  }, [abierto])

  const listado = useMemo(() => {
    const q = buscar.trim().toLowerCase()
    const base = valoresUnicos.map((v) => (v === '' ? VACIO : v))
    const filtrados = q ? base.filter((v) => v.toLowerCase().includes(q)) : base
    return filtrados.slice(0, TOPE_LISTA)
  }, [valoresUnicos, buscar])

  const marcados = useMemo(
    () => (filtro.valores === null ? null : new Set(filtro.valores)),
    [filtro.valores]
  )

  const estaMarcado = (valor: string) =>
    marcados === null || marcados.has(valor === VACIO ? '' : valor)

  const alternar = (valor: string) => {
    const real = valor === VACIO ? '' : valor
    const actuales = new Set(marcados ?? valoresUnicos)
    if (actuales.has(real)) actuales.delete(real)
    else actuales.add(real)
    const lista = valoresUnicos.filter((v) => actuales.has(v))
    onCambio({ ...filtro, valores: lista.length === valoresUnicos.length ? null : lista })
  }

  const marcarSoloVisibles = () => {
    onCambio({ ...filtro, valores: listado.map((v) => (v === VACIO ? '' : v)) })
  }

  return (
    <>
      <button
        ref={botonRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setAbierto((v) => !v)
        }}
        title={`Filtrar y ordenar por ${titulo}`}
        aria-label={`Filtrar y ordenar por ${titulo}`}
        className={`shrink-0 rounded-md p-1 transition-colors ${
          activo || orden
            ? 'bg-brand-green/10 text-brand-green'
            : 'text-gray-300 hover:bg-gray-100 hover:text-gray-500'
        }`}
      >
        {orden === 'asc' ? (
          <ArrowUpAZ className="h-3.5 w-3.5" />
        ) : orden === 'desc' ? (
          <ArrowDownAZ className="h-3.5 w-3.5" />
        ) : (
          <Filter className="h-3.5 w-3.5" />
        )}
      </button>

      {abierto &&
        pos &&
        createPortal(
          <div
            ref={panelRef}
            style={{ top: pos.top, left: pos.left, width: 260 }}
            className="fixed z-50 rounded-xl border border-gray-200 bg-white shadow-xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
              <p className="truncate font-heading text-xs font-bold text-gray-700">{titulo}</p>
              <button
                type="button"
                onClick={() => setAbierto(false)}
                className="rounded p-0.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            {ordenable && (
              <div className="flex gap-1 border-b border-gray-100 px-2 py-2">
                <button
                  type="button"
                  onClick={() => onOrden(orden === 'asc' ? null : 'asc')}
                  className={`flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-semibold transition-colors ${
                    orden === 'asc'
                      ? 'bg-brand-green text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  A → Z
                </button>
                <button
                  type="button"
                  onClick={() => onOrden(orden === 'desc' ? null : 'desc')}
                  className={`flex-1 rounded-lg px-2 py-1.5 font-body text-xs font-semibold transition-colors ${
                    orden === 'desc'
                      ? 'bg-brand-green text-white'
                      : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  Z → A
                </button>
              </div>
            )}

            <div className="px-2 py-2">
              <input
                value={filtro.texto}
                onChange={(e) => onCambio({ ...filtro, texto: e.target.value })}
                placeholder="Contiene…"
                className="w-full rounded-lg border border-gray-200 px-2 py-1.5 font-body text-xs outline-none focus:border-brand-green"
              />
            </div>

            <div className="border-t border-gray-100 px-2 pt-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-gray-300" />
                <input
                  value={buscar}
                  onChange={(e) => setBuscar(e.target.value)}
                  placeholder="Buscar valor…"
                  className="w-full rounded-lg border border-gray-200 py-1.5 pl-7 pr-2 font-body text-xs outline-none focus:border-brand-green"
                />
              </div>
              <div className="mt-1 flex items-center justify-between px-1 py-1">
                <button
                  type="button"
                  onClick={() => onCambio({ ...filtro, valores: null })}
                  className="font-body text-[11px] font-semibold text-brand-green hover:underline"
                >
                  Todos
                </button>
                <button
                  type="button"
                  onClick={marcarSoloVisibles}
                  className="font-body text-[11px] font-semibold text-gray-500 hover:underline"
                >
                  Solo lo visible
                </button>
              </div>
              <div className="max-h-52 overflow-y-auto pb-1">
                {listado.length === 0 && (
                  <p className="px-2 py-3 font-body text-xs text-gray-400">Sin valores.</p>
                )}
                {listado.map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => alternar(v)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-gray-50"
                  >
                    <span
                      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                        estaMarcado(v)
                          ? 'border-brand-green bg-brand-green text-white'
                          : 'border-gray-300 bg-white'
                      }`}
                    >
                      {estaMarcado(v) && <Check className="h-2.5 w-2.5" />}
                    </span>
                    <span className="truncate font-body text-xs text-gray-700">{v}</span>
                  </button>
                ))}
                {valoresUnicos.length > TOPE_LISTA && (
                  <p className="px-2 py-1 font-body text-[11px] text-gray-400">
                    Mostrando {TOPE_LISTA} de {valoresUnicos.length}. Usa el buscador.
                  </p>
                )}
              </div>
            </div>

            {(activo || orden) && (
              <div className="border-t border-gray-100 p-2">
                <button
                  type="button"
                  onClick={() => {
                    onCambio({ texto: '', valores: null })
                    onOrden(null)
                  }}
                  className="w-full rounded-lg bg-gray-50 px-2 py-1.5 font-body text-xs font-semibold text-gray-600 hover:bg-gray-100"
                >
                  Limpiar columna
                </button>
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  )
}

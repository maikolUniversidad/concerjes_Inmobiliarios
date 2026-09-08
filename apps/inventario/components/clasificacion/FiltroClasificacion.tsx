'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { Bookmark, BookmarkPlus, Check, SlidersHorizontal, Trash2, X } from 'lucide-react'
import {
  TIPO_CONTRATO_META, TIPO_CONTRATO_OPCIONES, colorEtiqueta, etiquetaSemana,
  type Categoria, type Etiqueta, type FiltroExtra,
} from '@/lib/clasificacion'
import {
  borrarPreferencia, firmaFiltros, guardarPreferencia, leerPreferencias,
  type PreferenciaFiltro,
} from '@/lib/filtros-preferencias'

/** Id local para la preferencia; `randomUUID` no existe en contextos no seguros. */
function nuevoId(): string {
  const c = globalThis.crypto
  return c && 'randomUUID' in c ? c.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Filtro por clasificación de contrato (tipo Directo/Privado + etiquetas).
 * Escribe el estado en la URL (?tipo=&etq=a,b) para que la página servidor
 * filtre. Reutilizable por Movimientos, Reportes, Aprovisionamiento, Órdenes.
 *
 * A la derecha acumula los filtros aplicados (cada uno se quita por separado) y
 * las "vistas rápidas": combinaciones guardadas con nombre en este navegador.
 *
 * `extras` declara otros filtros de la pantalla que viven en la URL (tipo de
 * movimiento, semana…): el panel no los dibuja, pero los resume a la derecha y
 * los guarda dentro de la vista rápida.
 */
export function FiltroClasificacion({ categorias, etiquetas, extras = [] }: {
  categorias: Categoria[]
  etiquetas: Etiqueta[]
  extras?: FiltroExtra[]
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  const tipo = (sp.get('tipo') ?? '').toUpperCase()
  const etqParam = sp.get('etq') ?? ''
  const etq = useMemo(
    () => etqParam.split(',').map(s => s.trim()).filter(Boolean),
    [etqParam]
  )

  /** Claves de URL que gobierna este panel: las propias más las de `extras`. */
  const claves = useMemo(() => ['tipo', 'etq', ...extras.map(e => e.clave)], [extras])

  /** Valor actual de cada filtro extra, ya sin vacíos. */
  const spString = sp.toString()
  const valoresExtra = useMemo(() => {
    const params = new URLSearchParams(spString)
    return extras
      .map(e => ({ extra: e, valor: params.get(e.clave) ?? '' }))
      .filter(x => x.valor !== '')
  }, [extras, spString])

  const activo = !!tipo || etq.length > 0 || valoresExtra.length > 0

  const [prefs, setPrefs] = useState<PreferenciaFiltro[]>([])
  const [nombrando, setNombrando] = useState(false)
  const [nombre, setNombre] = useState('')

  useEffect(() => { setPrefs(leerPreferencias(pathname)) }, [pathname])
  useEffect(() => { if (!activo) setNombrando(false) }, [activo])

  const filtrosActuales = useMemo(
    () => ({
      ...(tipo ? { tipo } : {}),
      ...(etq.length ? { etq: etq.join(',') } : {}),
      ...Object.fromEntries(valoresExtra.map(x => [x.extra.clave, x.valor])),
    }),
    [tipo, etq, valoresExtra]
  )
  const firmaActual = firmaFiltros(filtrosActuales)

  const porId = useMemo(() => new Map(etiquetas.map(e => [e.id, e])), [etiquetas])

  function aplicar(next: { tipo?: string | null; etq?: string[] }) {
    const params = new URLSearchParams(sp.toString())
    if ('tipo' in next) { next.tipo ? params.set('tipo', next.tipo) : params.delete('tipo') }
    if ('etq' in next) { next.etq && next.etq.length ? params.set('etq', next.etq.join(',')) : params.delete('etq') }
    router.push(`${pathname}?${params.toString()}`)
  }

  function toggleEtq(cat: Categoria, id: string) {
    const enCat = etiquetas.filter(e => e.categoria_id === cat.id).map(e => e.id)
    let next: string[]
    if (etq.includes(id)) next = etq.filter(x => x !== id)
    else if (cat.multiple) next = [...etq, id]
    else next = [...etq.filter(x => !enCat.includes(x)), id]
    aplicar({ etq: next })
  }

  function aplicarPreferencia(p: PreferenciaFiltro) {
    const params = new URLSearchParams(sp.toString())
    for (const k of claves) {
      const v = p.filtros[k]
      if (v) params.set(k, v)
      else params.delete(k)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  /** Quita un filtro extra sin tocar el resto de la URL. */
  function quitarExtra(clave: string) {
    const params = new URLSearchParams(sp.toString())
    params.delete(clave)
    router.push(`${pathname}?${params.toString()}`)
  }

  /** Limpia sólo los filtros de este panel; deja intactos los demás params. */
  function limpiarTodo() {
    const params = new URLSearchParams(sp.toString())
    for (const k of claves) params.delete(k)
    router.push(`${pathname}?${params.toString()}`)
  }

  function guardar() {
    const limpio = nombre.trim()
    if (!limpio) return
    setPrefs(guardarPreferencia(pathname, limpio, filtrosActuales, nuevoId()))
    setNombre('')
    setNombrando(false)
  }

  const conValores = categorias.filter(c => etiquetas.some(e => e.categoria_id === c.id))

  /** Filtros aplicados, ya resueltos a grupo + nombre + color + cómo se quitan. */
  const aplicados: { key: string; grupo: string; label: string; badge: string; quitar: () => void }[] = [
    ...(tipo === 'DIRECTO' || tipo === 'PRIVADO'
      ? [{
        key: `tipo:${tipo}`,
        grupo: 'Tipo',
        label: TIPO_CONTRATO_META[tipo].label,
        badge: TIPO_CONTRATO_META[tipo].badge,
        quitar: () => aplicar({ tipo: null }),
      }]
      : []),
    ...etq.map(id => {
      const e = porId.get(id)
      const cat = e ? categorias.find(c => c.id === e.categoria_id) : undefined
      return {
        key: `etq:${id}`,
        grupo: cat?.nombre ?? 'Etiqueta',
        label: e?.nombre ?? 'Etiqueta eliminada',
        badge: colorEtiqueta(e?.color ?? cat?.color).badge,
        quitar: () => aplicar({ etq: etq.filter(x => x !== id) }),
      }
    }),
    ...valoresExtra.map(({ extra, valor }) => {
      const op = extra.opciones?.[valor]
      return {
        key: `x:${extra.clave}`,
        grupo: extra.grupo,
        label: op?.label ?? (extra.formato === 'semana' ? etiquetaSemana(valor) : valor),
        badge: op?.badge ?? 'bg-gray-100 text-gray-600',
        quitar: () => quitarExtra(extra.clave),
      }
    }),
  ]

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-white shadow-sm">
      <div className="grid lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Selección de filtros */}
        <div className="space-y-3 p-3">
          <span className="flex items-center gap-1.5 font-body text-xs font-semibold uppercase tracking-wide text-gray-500">
            <SlidersHorizontal className="h-3.5 w-3.5" /> Filtrar por contrato
          </span>

          <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5">
              <p className="font-body text-[11px] uppercase tracking-wide text-gray-400">Tipo</p>
              <div className="flex flex-wrap gap-1.5">
                {TIPO_CONTRATO_OPCIONES.map(o => (
                  <button key={o.value} onClick={() => aplicar({ tipo: tipo === o.value ? null : o.value })}
                    className={`rounded-full border px-2.5 py-0.5 font-body text-xs font-semibold transition-all ${
                      tipo === o.value ? `${TIPO_CONTRATO_META[o.value].badge} border-transparent` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                    }`}>{o.label}</button>
                ))}
              </div>
            </div>

            {conValores.map(cat => (
              <div key={cat.id} className="space-y-1.5">
                <p className="font-body text-[11px] uppercase tracking-wide text-gray-400">{cat.nombre}</p>
                <div className="flex flex-wrap gap-1.5">
                  {etiquetas.filter(e => e.categoria_id === cat.id).map(e => {
                    const sel = etq.includes(e.id)
                    const c = colorEtiqueta(e.color ?? cat.color)
                    return (
                      <button key={e.id} onClick={() => toggleEtq(cat, e.id)}
                        className={`rounded-full border px-2.5 py-0.5 font-body text-xs transition-all ${
                          sel ? `${c.badge} border-transparent font-semibold` : 'border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}>{e.nombre}</button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Resumen de lo aplicado + vistas rápidas */}
        <aside className="space-y-3 border-t border-gray-100 bg-gray-50/70 p-3 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between gap-2">
            <span className="font-body text-xs font-semibold uppercase tracking-wide text-gray-500">
              Aplicados {aplicados.length > 0 && <span className="text-gray-400">({aplicados.length})</span>}
            </span>
            {activo && (
              <button onClick={limpiarTodo} className="inline-flex items-center gap-1 font-body text-xs text-gray-400 hover:text-red-600">
                <X className="h-3 w-3" /> Limpiar
              </button>
            )}
          </div>

          {aplicados.length === 0 ? (
            <p className="font-body text-xs text-gray-400">Sin filtros: se muestra todo.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {aplicados.map(a => (
                <span key={a.key} title={`${a.grupo}: ${a.label}`}
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-body text-xs font-medium ${a.badge}`}>
                  <span className="opacity-60">{a.grupo}:</span> {a.label}
                  <button onClick={a.quitar} aria-label={`Quitar filtro ${a.label}`}
                    className="-mr-0.5 rounded-full p-0.5 opacity-60 hover:bg-black/10 hover:opacity-100">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="space-y-1.5 border-t border-gray-200/70 pt-2.5">
            <span className="flex items-center gap-1.5 font-body text-xs font-semibold uppercase tracking-wide text-gray-500">
              <Bookmark className="h-3.5 w-3.5" /> Vistas rápidas
            </span>

            {prefs.length === 0 && !nombrando && (
              <p className="font-body text-xs text-gray-400">Guarda una combinación para aplicarla de un clic.</p>
            )}

            {prefs.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {prefs.map(p => {
                  const sel = firmaFiltros(p.filtros) === firmaActual
                  return (
                    <span key={p.id}
                      className={`group inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 font-body text-xs transition-all ${
                        sel ? 'border-brand-green bg-brand-green text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                      }`}>
                      <button onClick={() => aplicarPreferencia(p)} className="inline-flex items-center gap-1 font-semibold">
                        {sel && <Check className="h-3 w-3" />} {p.nombre}
                      </button>
                      <button onClick={() => setPrefs(borrarPreferencia(pathname, p.id))} aria-label={`Borrar vista ${p.nombre}`}
                        className={`rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100 ${sel ? 'hover:bg-black/20' : 'hover:text-red-600'}`}>
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}

            {nombrando ? (
              <div className="flex items-center gap-1.5 pt-0.5">
                <input autoFocus value={nombre} onChange={e => setNombre(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') guardar(); if (e.key === 'Escape') setNombrando(false) }}
                  placeholder="Nombre de la vista" maxLength={40}
                  className="w-full min-w-0 rounded-lg border border-gray-200 px-2 py-1 font-body text-xs outline-none focus:border-brand-green" />
                <button onClick={guardar} disabled={!nombre.trim()}
                  className="shrink-0 rounded-lg bg-brand-green px-2 py-1 font-body text-xs font-semibold text-white disabled:opacity-40">
                  Guardar
                </button>
                <button onClick={() => setNombrando(false)} aria-label="Cancelar"
                  className="shrink-0 rounded-lg p-1 text-gray-400 hover:text-gray-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              activo && (
                <button onClick={() => setNombrando(true)}
                  className="inline-flex items-center gap-1 font-body text-xs font-semibold text-brand-green hover:underline">
                  <BookmarkPlus className="h-3.5 w-3.5" /> Guardar filtros actuales
                </button>
              )
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}

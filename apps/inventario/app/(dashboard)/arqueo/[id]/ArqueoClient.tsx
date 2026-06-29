'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Users, Loader2, CheckCircle2, AlertTriangle, Lock, Printer, ClipboardCheck, Wifi,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cerrarArqueo } from '../actions'

export interface ItemRow {
  id: string
  producto_id: string
  ref: number | null
  nombre: string
  presentacion: string | null
  cantidad_sistema: number
  cantidad_fisica: number | null
  estado: 'PENDIENTE' | 'CONTADO' | 'AJUSTADO'
  observacion: string | null
  contado_por_nombre: string | null
  precio_lista: number | null
}
export interface ArqueoHeader {
  id: string
  nombre: string
  descripcion: string | null
  estado: 'ABIERTO' | 'CERRADO' | 'ANULADO'
  valor_diferencia: number | null
  cerrado_at: string | null
}

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export function ArqueoClient({ arqueo, itemsIniciales, usuario }: {
  arqueo: ArqueoHeader
  itemsIniciales: ItemRow[]
  usuario: { id: string; nombre: string }
}) {
  const [items, setItems] = useState<ItemRow[]>(itemsIniciales)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filtro, setFiltro] = useState<'todos' | 'pendiente' | 'contado' | 'diferencia'>('todos')
  const [presentes, setPresentes] = useState<string[]>([])
  const [conectado, setConectado] = useState(false)
  const focusRef = useRef<string | null>(null)
  const abierto = arqueo.estado === 'ABIERTO'

  // Realtime: cambios en arqueo_items + presencia de usuarios
  useEffect(() => {
    if (!abierto) return
    const supabase = createClient()
    const canal = supabase.channel(`arqueo:${arqueo.id}`, { config: { presence: { key: usuario.id } } })

    canal
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'arqueo_items', filter: `arqueo_id=eq.${arqueo.id}` },
        (payload) => {
          const n = payload.new as Partial<ItemRow> & { id: string }
          setItems(prev => prev.map(it => it.id === n.id ? { ...it, ...n } as ItemRow : it))
          if (focusRef.current !== n.id && n.cantidad_fisica !== null && n.cantidad_fisica !== undefined) {
            setDraft(d => ({ ...d, [n.id]: String(n.cantidad_fisica) }))
          }
        })
      .on('presence', { event: 'sync' }, () => {
        const state = canal.presenceState() as Record<string, { nombre?: string }[]>
        const nombres = Object.values(state).flat().map(p => p.nombre ?? 'Usuario')
        setPresentes(Array.from(new Set(nombres)))
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConectado(true)
          await canal.track({ nombre: usuario.nombre })
        }
      })

    return () => { supabase.removeChannel(canal) }
  }, [arqueo.id, abierto, usuario.id, usuario.nombre])

  const contar = useCallback(async (item: ItemRow) => {
    const raw = draft[item.id]
    if (raw === undefined || raw === '') return
    const cantidad = Number(raw)
    if (!Number.isFinite(cantidad) || cantidad < 0) return
    if (item.cantidad_fisica !== null && Number(item.cantidad_fisica) === cantidad) return

    setSaving(s => new Set(s).add(item.id))
    // Optimista
    setItems(prev => prev.map(it => it.id === item.id
      ? { ...it, cantidad_fisica: cantidad, estado: 'CONTADO', contado_por_nombre: usuario.nombre } : it))
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supabase = createClient() as any
      await supabase.rpc('contar_item', { p_item: item.id, p_cantidad: cantidad, p_obs: null })
    } finally {
      setSaving(s => { const n = new Set(s); n.delete(item.id); return n })
    }
  }, [draft, usuario.nombre])

  // Métricas en vivo
  const m = useMemo(() => {
    const contados = items.filter(i => i.estado !== 'PENDIENTE')
    const conDif = items.filter(i => i.cantidad_fisica !== null && Number(i.cantidad_fisica) !== Number(i.cantidad_sistema))
    const valor = conDif.reduce((a, i) => a + (Number(i.cantidad_fisica) - Number(i.cantidad_sistema)) * (i.precio_lista ?? 0), 0)
    const exactitud = contados.length > 0 ? Math.round(((contados.length - conDif.length) / contados.length) * 100) : 0
    return { total: items.length, contados: contados.length, conDif: conDif.length, valor, exactitud, pendientes: items.length - contados.length }
  }, [items])

  const filtrados = useMemo(() => items.filter(i => {
    const q = search.toLowerCase()
    const matchS = !q || i.nombre.toLowerCase().includes(q) || String(i.ref ?? '').includes(q)
    const dif = i.cantidad_fisica !== null && Number(i.cantidad_fisica) !== Number(i.cantidad_sistema)
    const matchF = filtro === 'todos' ||
      (filtro === 'pendiente' && i.estado === 'PENDIENTE') ||
      (filtro === 'contado' && i.estado !== 'PENDIENTE') ||
      (filtro === 'diferencia' && dif)
    return matchS && matchF
  }), [items, search, filtro])

  const progreso = m.total > 0 ? Math.round((m.contados / m.total) * 100) : 0

  return (
    <div className="space-y-5">
      {/* Cabecera con métricas */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-heading font-bold text-xl text-gray-900">{arqueo.nombre}</h1>
              {abierto
                ? <span className="bg-blue-100 text-blue-700 font-body text-xs font-semibold px-2 py-0.5 rounded-full">En progreso</span>
                : <span className="bg-green-100 text-green-700 font-body text-xs font-semibold px-2 py-0.5 rounded-full">Cerrado</span>}
            </div>
            {arqueo.descripcion && <p className="font-body text-sm text-gray-500 mt-0.5">{arqueo.descripcion}</p>}
          </div>

          {/* Presencia */}
          {abierto && (
            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 font-body text-xs ${conectado ? 'text-green-600' : 'text-gray-400'}`}>
                <Wifi className="w-3.5 h-3.5" /> {conectado ? 'En vivo' : 'Conectando...'}
              </span>
              <div className="flex items-center gap-1 bg-gray-50 rounded-full px-3 py-1.5">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                <span className="font-body text-xs text-gray-600">{presentes.length || 1} {(presentes.length || 1) === 1 ? 'persona' : 'personas'}</span>
                <div className="flex -space-x-2 ml-1">
                  {(presentes.length ? presentes : [usuario.nombre]).slice(0, 5).map((n, i) => (
                    <div key={i} title={n} className="w-6 h-6 rounded-full bg-brand-green text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-white">
                      {n.split(' ').map(x => x[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Métricas */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4">
          {[
            { label: 'Total', value: m.total, cls: 'text-gray-900' },
            { label: 'Contados', value: m.contados, cls: 'text-blue-700' },
            { label: 'Pendientes', value: m.pendientes, cls: 'text-amber-600' },
            { label: 'Con diferencia', value: m.conDif, cls: 'text-red-600' },
            { label: 'Exactitud', value: `${m.exactitud}%`, cls: 'text-green-700' },
          ].map(k => (
            <div key={k.label} className="rounded-xl border border-gray-100 p-3 text-center">
              <p className={`font-heading font-bold text-2xl ${k.cls}`}>{k.value}</p>
              <p className="font-body text-xs text-gray-500">{k.label}</p>
            </div>
          ))}
        </div>

        {abierto && (
          <>
            <div className="flex justify-between font-body text-xs text-gray-500 mt-4 mb-1">
              <span>Progreso del conteo</span><span>{progreso}%</span>
            </div>
            <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-brand-green rounded-full transition-all" style={{ width: `${progreso}%` }} />
            </div>
          </>
        )}

        {!abierto && (
          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <p className="font-body text-sm text-gray-600">
              Impacto del ajuste: <strong className={(arqueo.valor_diferencia ?? 0) < 0 ? 'text-red-600' : 'text-green-700'}>{cop.format(arqueo.valor_diferencia ?? 0)}</strong>
              {arqueo.cerrado_at && <span className="text-gray-400"> · cerrado el {new Date(arqueo.cerrado_at).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
            </p>
            <button onClick={() => window.print()} className="flex items-center gap-2 border border-gray-200 text-gray-600 font-body font-semibold text-sm px-4 py-2 rounded-lg hover:bg-gray-50">
              <Printer className="w-4 h-4" /> Imprimir reporte
            </button>
          </div>
        )}
      </div>

      {/* Cerrar arqueo */}
      {abierto && (
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 flex items-center justify-between gap-4 flex-wrap">
          <p className="font-body text-sm text-amber-800">
            Al cerrar, se aplicarán los <strong>ajustes de stock</strong> de los {m.conDif} ítems con diferencia y se generará el reporte. Esta acción no se puede deshacer.
          </p>
          <form action={cerrarArqueo} onSubmit={(e) => { if (!window.confirm(`¿Cerrar el arqueo y ajustar ${m.conDif} productos con diferencia?`)) e.preventDefault() }}>
            <input type="hidden" name="id" value={arqueo.id} />
            <button type="submit" className="flex items-center gap-2 bg-brand-green text-white font-body font-semibold text-sm px-4 py-2.5 rounded-lg hover:bg-brand-green-dark transition-colors whitespace-nowrap">
              <Lock className="w-4 h-4" /> Cerrar y ajustar
            </button>
          </form>
        </div>
      )}

      {/* Filtros */}
      <div className="bg-white border border-gray-100 rounded-xl p-3 flex flex-wrap gap-3 shadow-sm items-center">
        <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[200px]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar producto por nombre o REF..."
            className="font-body text-sm flex-1 outline-none placeholder:text-gray-400" />
        </div>
        <div className="flex gap-1">
          {([['todos', 'Todos'], ['pendiente', 'Pendientes'], ['contado', 'Contados'], ['diferencia', 'Con diferencia']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFiltro(k)}
              className={`font-body text-xs font-semibold px-3 py-2 rounded-lg transition-colors ${filtro === k ? 'bg-brand-green text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* Tabla de conteo */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Producto</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Sistema</th>
                <th className="text-center font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3 w-32">Físico</th>
                <th className="text-right font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Diferencia</th>
                <th className="text-left font-body font-semibold text-xs text-gray-500 uppercase px-4 py-3">Contado por</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtrados.map(it => {
                const fisica = it.cantidad_fisica
                const dif = fisica !== null ? Number(fisica) - Number(it.cantidad_sistema) : null
                const contado = it.estado !== 'PENDIENTE'
                return (
                  <tr key={it.id} className={`hover:bg-gray-50/50 ${dif !== null && dif !== 0 ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-gray-400">{it.ref ?? '—'}</span>
                        <div>
                          <p className="font-body font-medium text-sm text-gray-900">{it.nombre}</p>
                          <p className="font-body text-xs text-gray-400">{it.presentacion}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right font-heading font-bold text-base text-gray-700">{Number(it.cantidad_sistema)}</td>
                    <td className="px-4 py-2.5">
                      {abierto ? (
                        <div className="relative">
                          <input
                            type="number" min="0" step="0.01"
                            value={draft[it.id] ?? (fisica !== null ? String(fisica) : '')}
                            onChange={e => setDraft(d => ({ ...d, [it.id]: e.target.value }))}
                            onFocus={() => { focusRef.current = it.id }}
                            onBlur={() => { focusRef.current = null; contar(it) }}
                            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
                            placeholder="—"
                            className={`w-full text-center border rounded-lg px-2 py-1.5 font-body text-sm outline-none focus:border-brand-green
                              ${contado ? 'border-brand-green/40 bg-green-50/40' : 'border-gray-200'}`}
                          />
                          {saving.has(it.id) && <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-green absolute right-1.5 top-2.5" />}
                        </div>
                      ) : (
                        <p className="text-center font-heading font-bold text-base text-gray-900">{fisica !== null ? Number(fisica) : '—'}</p>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {dif === null ? <span className="text-gray-300">—</span>
                        : dif === 0 ? <span className="inline-flex items-center gap-1 text-green-600 font-body text-sm"><CheckCircle2 className="w-3.5 h-3.5" /> OK</span>
                        : <span className={`inline-flex items-center gap-1 font-heading font-bold text-sm ${dif < 0 ? 'text-red-600' : 'text-amber-600'}`}>
                            <AlertTriangle className="w-3.5 h-3.5" /> {dif > 0 ? '+' : ''}{dif}
                          </span>}
                    </td>
                    <td className="px-4 py-2.5 font-body text-xs text-gray-500">{it.contado_por_nombre ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {filtrados.length === 0 && (
          <p className="py-10 text-center font-body text-sm text-gray-400">No hay ítems que coincidan.</p>
        )}
      </div>
    </div>
  )
}
